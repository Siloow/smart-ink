/** Offline geometry audit and CPU-render fixture generator. No browser required. */
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import * as THREE from 'three';
import { createSurfaceTopology, buildSurfaceChart, type SurfaceAnchor } from '../src/render/surfacePlacement';

const root=process.cwd(),out=process.env.PLACEMENT_REPORT_DIR||`${root}/reports/placement`;
const fixedSize=process.env.PLACEMENT_FIXED_SIZE==='1';
const sourceSha=crypto.createHash('sha256').update(fs.readFileSync(`${root}/src/render/surfacePlacement.ts`)).digest('hex');
fs.mkdirSync(out,{recursive:true});
const decoderPath=`${root}/public/draco/draco_decoder.js`;
const context={console,process,require:createRequire(import.meta.url),Buffer,__dirname:`${root}/public/draco`,__filename:decoderPath,module:{exports:{}},exports:{}};
vm.runInNewContext(fs.readFileSync(decoderPath,'utf8'),context);
interface DracoArray { GetValue(index:number):number }
interface DracoMesh { num_points():number; num_faces():number }
interface DracoBuffer { Init(data:Int8Array,length:number):void }
interface DracoDecoder {
 DecodeBufferToMesh(buffer:DracoBuffer,mesh:DracoMesh):{ok():boolean;error_msg():string};
 GetAttributeByUniqueId(mesh:DracoMesh,id:number):unknown;
 GetAttributeFloatForAllPoints(mesh:DracoMesh,attr:unknown,array:DracoArray):void;
 GetFaceFromMesh(mesh:DracoMesh,index:number,face:DracoArray):void;
}
interface DracoModule {
 DecoderBuffer:new()=>DracoBuffer; Decoder:new()=>DracoDecoder; Mesh:new()=>DracoMesh;
 DracoFloat32Array:new()=>DracoArray; DracoInt32Array:new()=>DracoArray;destroy(value:unknown):void;
}
const draco=await (context.module.exports as unknown as ()=>Promise<DracoModule>)();
type Spec={id:string;area?:string;x:number;h:number;side?:'side'|'back';seam?:boolean;size?:number;rotation?:number;aspect?:number;design?:string};
const specs:Spec[]=[
  {id:'chest',x:.12,h:.755},{id:'chest-seam',x:.25,h:.745,seam:true},
  {id:'ribs',x:.40,h:.665,side:'side',seam:true},{id:'shoulder',x:.52,h:.785,seam:true},
  {id:'upper-arm',x:.62,h:.725},{id:'forearm',x:.81,h:.61,seam:true},
  {id:'thigh',x:.25,h:.405},{id:'thigh-seam',x:.25,h:.405,side:'side',seam:true},
  {id:'knee',x:.35,h:.275},{id:'calf',x:.46,h:.17,side:'back'},
  {id:'back',x:.20,h:.755,side:'back',seam:true},{id:'armpit',x:.48,h:.755,side:'side'},
  {id:'inner-thigh',x:.105,h:.40},{id:'hand',x:.95,h:.505},
];
const extra:Spec[]=[];
for(const rotation of [45,90,180])for(const aspect of [.45,2.2])extra.push({...specs[3],id:`shoulder-r${rotation}-a${aspect}`,rotation,aspect,design:'arrow'});
for(const size of [.12,.8,1.2])extra.push({...specs[5],id:`forearm-size${size}`,size,rotation:45});
const regressions:Spec[]=[];
for(const area of ['shoulder','upper-arm','armpit'])for(const size of [.42,.7,1.0])for(const rotation of [0,45,90])for(const design of ['grid','arrow']){
 const base=specs.find(s=>s.id===area)!;
 regressions.push({...base,area,id:`${area}-size${size}-r${rotation}-${design}`,size,rotation,design,seam:false});
}

/** Rasterize the design domain in chart coordinates: multiple hits mean duplicate ink. */
function multiplicity(geo:THREE.BufferGeometry,chart:{uv:Float32Array;mask:Float32Array;faceMask?:ArrayLike<number>},size:number,aspect:number,rotation:number){
 const resolution=96,coverage=new Uint16Array(resolution*resolution),index=geo.index!,c=Math.cos(rotation),s=Math.sin(rotation);
 const width=Math.max(1e-8,size*Math.min(aspect,1)),height=Math.max(1e-8,size*Math.min(1/aspect,1));
 let reversedFaces=0,paintedFaces=0;
 for(let f=0;f<index.count/3;f++){
  if(chart.faceMask && chart.faceMask[f]<.999)continue;
  const ids=[index.getX(f*3),index.getX(f*3+1),index.getX(f*3+2)];if(ids.some(i=>chart.mask[i]<.999))continue;
  const v=ids.map(i=>{const x=chart.uv[i*2],y=chart.uv[i*2+1];return [(c*x+s*y)/width+.5,(-s*x+c*y)/height+.5];});
  const [a,b,d]=v,den=(b[1]-d[1])*(a[0]-d[0])+(d[0]-b[0])*(a[1]-d[1]);if(Math.abs(den)<1e-12)continue;
  const loX=Math.max(0,Math.floor(Math.min(...v.map(p=>p[0]))*resolution)),hiX=Math.min(resolution-1,Math.ceil(Math.max(...v.map(p=>p[0]))*resolution));
  const loY=Math.max(0,Math.floor(Math.min(...v.map(p=>p[1]))*resolution)),hiY=Math.min(resolution-1,Math.ceil(Math.max(...v.map(p=>p[1]))*resolution));
  let painted=false;
  for(let y=loY;y<=hiY;y++)for(let x=loX;x<=hiX;x++){
   const px=(x+.413)/resolution,py=(y+.537)/resolution;
   const wa=((b[1]-d[1])*(px-d[0])+(d[0]-b[0])*(py-d[1]))/den,wb=((d[1]-a[1])*(px-d[0])+(a[0]-d[0])*(py-d[1]))/den;
   if(wa>1e-8&&wb>1e-8&&1-wa-wb>1e-8){coverage[y*resolution+x]++;painted=true;}
  }
  if(painted){paintedFaces++;if(den<0)reversedFaces++;}
 }
 let covered=0,duplicate=0,max=0;for(const n of coverage){if(n)covered++;if(n>1)duplicate++;max=Math.max(max,n);}
 return {paintedFaces,reversedFaces,coveredSamples:covered,duplicateSamples:duplicate,maxMultiplicity:max,duplicateFraction:covered?duplicate/covered:0,coverageFraction:covered/coverage.length,coverage:Array.from(coverage),coverageResolution:resolution};
}

function load(sex:string){
 const data=fs.readFileSync(`${root}/public/models/body_${sex}_realistic.glb`),length=data.readUInt32LE(12),json=JSON.parse(data.subarray(20,20+length).toString());
 const bin=data.subarray(28+length),primitive=json.meshes[0].primitives[0],ext=primitive.extensions.KHR_draco_mesh_compression,view=json.bufferViews[ext.bufferView];
 const encoded=new Int8Array(bin.buffer,bin.byteOffset+(view.byteOffset||0),view.byteLength),buffer=new draco.DecoderBuffer();buffer.Init(encoded,encoded.length);
 const decoder=new draco.Decoder(),mesh=new draco.Mesh(),status=decoder.DecodeBufferToMesh(buffer,mesh);if(!status.ok())throw Error(status.error_msg());
 const geo=new THREE.BufferGeometry();
 for(const [name,attrName,count]of [['POSITION','position',3],['NORMAL','normal',3],['TEXCOORD_0','uv',2]] as const){
  const attr=decoder.GetAttributeByUniqueId(mesh,ext.attributes[name]),array=new draco.DracoFloat32Array();decoder.GetAttributeFloatForAllPoints(mesh,attr,array);
  const floats=new Float32Array(mesh.num_points()*count);for(let i=0;i<floats.length;i++)floats[i]=array.GetValue(i);draco.destroy(array);geo.setAttribute(attrName,new THREE.BufferAttribute(floats,count));
 }
 const indices=new Uint32Array(mesh.num_faces()*3),face=new draco.DracoInt32Array();for(let i=0;i<mesh.num_faces();i++){decoder.GetFaceFromMesh(mesh,i,face);for(let k=0;k<3;k++)indices[i*3+k]=face.GetValue(k);}geo.setIndex(new THREE.BufferAttribute(indices,1));
 for(const o of [face,buffer,mesh,decoder])draco.destroy(o);
 const box=new THREE.Box3().setFromBufferAttribute(geo.attributes.position as THREE.BufferAttribute),center=box.getCenter(new THREE.Vector3()),scale=4.2/(box.max.y-box.min.y);
 const matrix=new THREE.Matrix4().makeScale(scale,scale,scale);matrix.setPosition(center.multiplyScalar(-scale));
 const object=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));object.matrixAutoUpdate=false;object.matrix.copy(matrix);object.updateMatrixWorld(true);
 return {geo,object,matrix};
}
const all:Record<string,unknown>[]=[];
for(const sex of ['male','female']){
 const {geo,object,matrix}=load(sex),topology=createSurfaceTopology(geo),pos=geo.attributes.position,normal=geo.attributes.normal,uv=geo.attributes.uv,indices=geo.index!;
 const world=(i:number)=>new THREE.Vector3().fromBufferAttribute(pos,i).applyMatrix4(matrix);
 const faceIds=(i:number)=>[indices.getX(i*3),indices.getX(i*3+1),indices.getX(i*3+2)];
 const worldPositions=[] as number[];for(let i=0;i<pos.count;i++)worldPositions.push(...world(i).toArray());
 fs.writeFileSync(`${out}/${sex}-mesh.json`,JSON.stringify({positions:worldPositions,normals:Array.from(normal.array),atlas:Array.from(uv.array),indices:Array.from(indices.array)}));
 for(const original of fixedSize?regressions:[...specs,...extra]){
  const spec={...original};
  const area=spec.area||spec.id;
  if(spec.id.startsWith('shoulder')){spec.x=sex==='male'?.48:.46;spec.h=3.30/4.2;}
  if(area==='upper-arm'){spec.x=sex==='male'?.64:.54;spec.h=2.90/4.2;}
  if(spec.id.startsWith('forearm')){spec.x=sex==='male'?.81:.70;spec.h=2.50/4.2;}
  if(spec.id==='knee'){spec.x=sex==='male'?.365:.29;spec.h=1.05/4.2;}
  if(spec.id==='calf'){spec.x=sex==='male'?.39:.31;spec.h=.65/4.2;}
  if(spec.id==='ribs'){spec.x=.40;spec.h=2.60/4.2;}
  try{
   const target=new THREE.Vector3(spec.x,-2.1+spec.h*4.2,0),direction=spec.side==='back'?new THREE.Vector3(0,0,1):spec.side==='side'?new THREE.Vector3(-1,0,0):new THREE.Vector3(0,0,-1);
   const ray=new THREE.Raycaster(target.clone().addScaledVector(direction,-5),direction),hits=ray.intersectObject(object,false);
   if(!hits.length){
    let best=.22*.22, selected=-1;
    for(let t=0;t<indices.count/3;t++){
     const ids=faceIds(t),p=ids.map(world).reduce((a,b)=>a.add(b),new THREE.Vector3()).multiplyScalar(1/3);
     const n=ids.map(i=>new THREE.Vector3().fromBufferAttribute(normal,i)).reduce((a,b)=>a.add(b),new THREE.Vector3()).normalize();
     if(n.dot(direction)>-.2)continue;
     const d=(p.x-target.x)**2+(p.y-target.y)**2;if(d<best){best=d;selected=t;}
    }
    if(selected<0)throw Error('No body hit near requested anatomical center');
    const ids=faceIds(selected),p=ids.map(world).reduce((a,b)=>a.add(b),new THREE.Vector3()).multiplyScalar(1/3);
    hits.push({faceIndex:selected,point:p,distance:0,object});
   }
   const hit=spec.side==='side'&&spec.id!=='thigh-seam'?[...hits].sort((a,b)=>a.point.distanceToSquared(target)-b.point.distanceToSquared(target))[0]:hits[0];
   let point=hit.point.clone(),face=hit.faceIndex!;
   if(spec.seam){
    const first=new Map<number,number>();let best=.3*.3,bestVertex=-1;
    for(let i=0;i<pos.count;i++){
     const old=first.get(topology.welded[i]);
     if(old!==undefined&&Math.hypot(uv.getX(i)-uv.getX(old),uv.getY(i)-uv.getY(old))>.025&&new THREE.Vector3().fromBufferAttribute(normal,i).dot(direction)<-.25){const d=world(i).distanceToSquared(point);if(d<best){best=d;bestVertex=i;}}
     else first.set(topology.welded[i],i);
    }
    if(bestVertex>=0){for(let t=0;t<indices.count/3;t++)if(faceIds(t).includes(bestVertex)){face=t;point=world(bestVertex);break;}}
   }
   const ids=faceIds(face),vertices=ids.map(world),bary=new THREE.Vector3();THREE.Triangle.getBarycoord(point,...vertices as [THREE.Vector3,THREE.Vector3,THREE.Vector3],bary);
   const anchor:SurfaceAnchor={faceIndex:face,barycentric:bary.toArray() as [number,number,number],bodyMeshId:`body_${sex}_realistic`};
   const N=new THREE.Vector3(),centerUV=new THREE.Vector2();ids.forEach((id,k)=>{N.addScaledVector(new THREE.Vector3().fromBufferAttribute(normal,id),bary.getComponent(k));centerUV.addScaledVector(new THREE.Vector2().fromBufferAttribute(uv as THREE.BufferAttribute,id),bary.getComponent(k));});N.normalize();
   const start=performance.now(),chartResult=buildSurfaceChart(topology,geo,matrix,anchor),ms=performance.now()-start;
   const chart=chartResult??{uv:new Float32Array(pos.count*2),mask:new Float32Array(pos.count),maxSize:0,message:'Placement safely rejected: no valid local chart.'};
   const requested=spec.size??.4,aspect=spec.aspect??1,safeSize=chart.maxSize*Math.SQRT2/Math.hypot(1,Math.min(aspect,1/aspect)),size=fixedSize?requested:Math.min(requested,safeSize),rotation=(spec.rotation??0)*Math.PI/180,c=Math.cos(rotation),s=Math.sin(rotation);
   const dims=[size*Math.min(aspect,1),size*Math.min(1/aspect,1)];
   const within=(i:number)=>chart.mask[i]>.999&&Math.abs(c*chart.uv[i*2]+s*chart.uv[i*2+1])<dims[0]/2&&Math.abs(-s*chart.uv[i*2]+c*chart.uv[i*2+1])<dims[1]/2;
   const first=new Map<number,number>();let seamPairs=0,seamGap=0,maskGap=0,visible=0;const ratios:number[]=[];
   for(let i=0;i<pos.count;i++){
    if(within(i))visible++;
    const old=first.get(topology.welded[i]);
    if(old!==undefined&&(within(old)||within(i))&&Math.hypot(uv.getX(i)-uv.getX(old),uv.getY(i)-uv.getY(old))>.025){seamPairs++;seamGap=Math.max(seamGap,Math.hypot(chart.uv[old*2]-chart.uv[i*2],chart.uv[old*2+1]-chart.uv[i*2+1]));maskGap=Math.max(maskGap,Math.abs(chart.mask[old]-chart.mask[i]));}
    else first.set(topology.welded[i],i);
   }
   for(let t=0;t<indices.count/3;t++){const ids=faceIds(t);for(let k=0;k<3;k++){const a=ids[k],b=ids[(k+1)%3];if(!within(a)||!within(b))continue;const l=world(a).distanceTo(world(b));if(l>1e-6)ratios.push(Math.hypot(chart.uv[a*2]-chart.uv[b*2],chart.uv[a*2+1]-chart.uv[b*2+1])/l);}}
   ratios.sort((a,b)=>a-b);
   const faceMask=(chart as typeof chart&{faceMask?:ArrayLike<number>}).faceMask;
   const overlap=multiplicity(geo,{...chart,faceMask},size,aspect,rotation),{coverage,...overlapMetrics}=overlap;
   const result={sex,...spec,sourceSha,fixedSize,requested,size,aspect,rotation,point:point.toArray(),normal:N.toArray(),centerUV:centerUV.toArray(),anchor,rejected:!chartResult,maxSize:chart.maxSize,safeSize,message:chart.message??null,milliseconds:ms,seamPairs,seamGap,maskGap,visibleVertices:visible,...overlapMetrics,edgeScaleP05:ratios[Math.floor(ratios.length*.05)]??null,edgeScaleP50:ratios[Math.floor(ratios.length*.5)]??null,edgeScaleP95:ratios[Math.floor(ratios.length*.95)]??null,finite:Array.from(chart.uv).every(Number.isFinite)&&Array.from(chart.mask).every(Number.isFinite)};
   fs.writeFileSync(`${out}/${sex}-${spec.id}.json`,JSON.stringify({...result,chart:Array.from(chart.uv),mask:Array.from(chart.mask),faceMask:faceMask?Array.from(faceMask):null,coverage}));all.push(result);console.log(`${sex}/${spec.id} safe=${chart.maxSize.toFixed(3)} applied=${size.toFixed(2)} duplicates=${overlap.duplicateSamples} maxCopies=${overlap.maxMultiplicity} reversed=${overlap.reversedFaces} ${ms.toFixed(0)}ms`);
  }catch(error){const result={sex,...spec,error:String(error)};all.push(result);console.error(result);}
 }
}
fs.writeFileSync(`${out}/results.json`,JSON.stringify({generatedAt:new Date().toISOString(),sourceSha,fixedSize,results:all},null,2));
