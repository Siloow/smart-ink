/** Actual shipped GLBs + production surface charts and atlas-edge padding.
 * CPU rasterization is diagnostic; this does not execute browser WebGL. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import draco3d from 'draco3d';
import * as THREE from 'three';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url)),out=path.join(root,'reports/example-tattoo');await fs.mkdir(out,{recursive:true});
const decoderModule=await draco3d.createDecoderModule({});
const loader=await fs.readFile(path.join(root,'tools/placement-face-mask.test.mjs'),'utf8');
const loadBody=eval(`(${loader.slice(loader.indexOf('async function loadBody('),loader.indexOf('\nfor (const sex of'))})`);
const bake=await fs.readFile(path.join(root,'src/render/bakeInkLayer.ts'),'utf8');
const bundles=await build({stdin:{contents:`${bake}\nexport {padIslandEdges};export * from './surfacePlacement';export * from './tattooSource';export * from './tattooCamera';export * from './bodyShape';export * from './bodyPose';`,resolveDir:path.join(root,'src/render'),loader:'ts'},bundle:true,write:false,format:'esm',platform:'node'});
const api=await import(`data:text/javascript;base64,${Buffer.from(bundles.outputFiles[0].text).toString('base64')}`);
const shader=await fs.readFile(path.join(root,'src/render/tattooLayer.ts'),'utf8');
assert.match(shader,/mask < 0\.9999/);assert.match(shader,/c \* offset\.x \+ s \* offset\.y, -s \* offset\.x \+ c \* offset\.y/);
assert.equal(api.resolveTattooSource(null),'/logo.png');
const geometry=await loadBody(path.join(root,'public/models/body_male_realistic.glb'));
const flat=geometry.toNonIndexed(),topology=api.createSurfaceTopology(flat),atlas=flat.attributes.uv,pos=flat.attributes.position;
const mesh=new THREE.Mesh(flat,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.updateMatrixWorld(true);
async function focusedProofs(){
 for(const name of ['black-default','rotated-seam-posed']){
  const previous=path.join(out,name),c=JSON.parse(await fs.readFile(path.join(previous,'chart.json'),'utf8'));
  const posed=flat.clone(),deformable=api.prepareDeformable(posed),bounds=api.shapeBounds([deformable]);
  api.applyBodyShape([deformable],bounds,api.DEFAULT_BODY_SHAPE);
  api.applyBodyPose([deformable],bounds,api.poseFromPreset(c.pose));
  posed.computeBoundingBox();const center=posed.boundingBox.getCenter(new THREE.Vector3());
  const matrix=new THREE.Matrix4().makeTranslation(-center.x,-center.y,-center.z);
  posed.setAttribute('aTattooUv',new THREE.Float32BufferAttribute(c.chart,2));
  posed.setAttribute('aTattooMask',new THREE.Float32BufferAttribute(c.mask,1));
  const framing=api.tattooFramingFromGeometry(posed,matrix,c.anchor,{size:c.size,aspect:c.aspect,rotationRad:c.rotation});
  assert.ok(framing,`Focused framing missing for ${name}`);
  const camera={...api.frameTattoo(framing,api.DEFAULT_TATTOO_CAMERA_ADJUSTMENT,1),aspect:1,preserveFraming:true,aperture:8};
  assert.deepEqual(camera.target,framing.center,'Camera target must remain the placed anchor');
  const probe=new THREE.PerspectiveCamera(camera.fov,1,.001,100);probe.position.fromArray(camera.position);probe.lookAt(new THREE.Vector3(...camera.target));probe.updateMatrixWorld(true);
  for(let i=0;i<framing.points.length;i+=3){const p=new THREE.Vector3().fromArray(framing.points,i).project(probe);assert.ok(Math.abs(p.x)<=1.00001&&Math.abs(p.y)<=1.00001&&p.z<1,'Focused camera clips the tattoo footprint');}
  const folder=path.join(out,`focused-${name}`);await fs.mkdir(folder,{recursive:true});
  await fs.copyFile(path.join(previous,'ink.png'),path.join(folder,'ink.png'));
  await fs.writeFile(path.join(folder,'chart.json'),JSON.stringify({...c,id:`focused-${name}`,camera,
   framing:{center:framing.center,normal:framing.normal,radius:framing.radius,points:framing.points.length/3},
   cameraSourceSha:createHash('sha256').update(await fs.readFile(path.join(root,'src/render/tattooCamera.ts'))).digest('hex')}));
  console.log(`Focused ${name}: ${framing.points.length/3} footprint points fit, target remains anchor, pose=${c.pose}`);posed.dispose();
 }
}
// Reuse existing atlas proofs unchanged when only the camera is under review.
if(process.argv.includes('--focused-only')){await focusedProofs();process.exit(0);}
const cases=[{id:'black-default',x:.17,y:1,size:.42,rotation:0,color:'#000000',opacity:1,pose:'neutral'},
 {id:'rotated-seam-posed',x:.48,y:1.12,size:.65,rotation:Math.PI/4,color:'#880e4f',opacity:.55,pose:'arms_out',seam:true},
 {id:'hidden',x:.17,y:1,size:.42,rotation:0,color:'#000000',opacity:0,pose:'neutral'}];
for(const c of cases){
 const hit=new THREE.Raycaster(new THREE.Vector3(c.x,c.y,4),new THREE.Vector3(0,0,-1)).intersectObject(mesh)[0];assert.ok(hit,c.id);
 let face=hit.faceIndex,point=hit.point.clone();
 if(c.seam){const first=new Map();let best=.5**2,vertex=-1;
  for(let i=0;i<pos.count;i++){const old=first.get(topology.welded[i]);if(old===undefined){first.set(topology.welded[i],i);continue;}
   if(Math.hypot(atlas.getX(i)-atlas.getX(old),atlas.getY(i)-atlas.getY(old))<.05||flat.attributes.normal.getZ(i)<.2)continue;
   const p=new THREE.Vector3().fromBufferAttribute(pos,i),d=p.distanceToSquared(point);if(d<best){best=d;vertex=i;}}
  assert.ok(vertex>=0,'Shoulder must actually cross an original atlas seam');face=Math.floor(vertex/3);point.fromBufferAttribute(pos,vertex);
 }
 const bary=new THREE.Vector3();THREE.Triangle.getBarycoord(point,...[0,1,2].map(k=>new THREE.Vector3().fromBufferAttribute(pos,face*3+k)),bary);
 const anchor={faceIndex:face,barycentric:bary.toArray(),bodyMeshId:'body_full'};
 const chart=api.buildSurfaceChart(topology,flat,new THREE.Matrix4(),anchor);assert.ok(chart&&chart.maxSize>.045,c.id);
 const mask=chart.mask.slice();for(let i=0;i<chart.faceMask.length;i++)if(chart.faceMask[i]<.5)mask.fill(0,i*3,i*3+3);
 const folder=path.join(out,c.id);await fs.mkdir(folder,{recursive:true});
 await fs.writeFile(path.join(folder,'chart.json'),JSON.stringify({...c,point:point.toArray(),anchor,source:api.resolveTattooSource(null),aspect:1,atlas:Array.from(atlas.array),chart:Array.from(chart.uv),mask:Array.from(mask),shaderSha:createHash('sha256').update(shader).digest('hex')}));
}
const python=process.env.PROOF_PYTHON||'python3';
const run=spawnSync(python,[path.join(root,'tools/example-tattoo-raster.py'),out,path.join(root,'public/logo.png')],{stdio:'inherit'});assert.equal(run.status,0);
for(const c of cases){const folder=path.join(out,c.id),raw=new Uint8Array(await fs.readFile(path.join(folder,'ink.rgba'))),coverage=new Uint8Array(await fs.readFile(path.join(folder,'coverage.rgba')));
 api.padIslandEdges(raw,coverage,2048);await fs.writeFile(path.join(folder,'ink.rgba'),raw);
 const save=spawnSync(python,['-c','from PIL import Image; import sys; Image.frombytes("RGBA",(2048,2048),open(sys.argv[1],"rb").read()).save(sys.argv[2])',path.join(folder,'ink.rgba'),path.join(folder,'ink.png')],{stdio:'inherit'});assert.equal(save.status,0);
 if(c.id==='hidden')assert.ok(raw.every(v=>v===0));else assert.ok(raw.some((v,i)=>i%4===3&&v>0));
}
console.log('Built-in logo proof: real GLB, production seam charts/masks/padding, rotation/tint/opacity and blank hidden layer generated. WebGL stage not executed.');
await focusedProofs();
