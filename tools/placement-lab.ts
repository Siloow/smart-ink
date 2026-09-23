import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { createSurfaceTopology, buildSurfaceChart, type SurfaceAnchor } from '../src/render/surfacePlacement';
import { SURFACE_TATTOO_GLSL, TATTOO_LAYER_GLSL } from '../src/render/tattooLayer';

type Case = { id: string; label: string; x: number; h: number; side?: 'back' | 'side'; seam?: boolean };
const cases: Case[] = [
  { id: 'chest', label: 'Chest / sternum', x: 0.12, h: .755 },
  { id: 'chest-seam', label: 'Chest atlas seam', x: .25, h: .745, seam: true },
  { id: 'ribs', label: 'Ribs / torso side seam', x: .40, h: .665, side: 'side', seam: true },
  { id: 'shoulder', label: 'Shoulder cap / upper arm seam', x: .52, h: .785, seam: true },
  { id: 'upper-arm', label: 'Upper arm', x: .62, h: .725 },
  { id: 'forearm', label: 'Forearm seam', x: .81, h: .61, seam: true },
  { id: 'thigh', label: 'Front thigh', x: .25, h: .405 },
  { id: 'thigh-seam', label: 'Outer thigh seam', x: .25, h: .405, side: 'side', seam: true },
  { id: 'knee', label: 'Knee / bend', x: .35, h: .275 },
  { id: 'calf', label: 'Back calf', x: .46, h: .17, side: 'back' },
  { id: 'back', label: 'Upper back seam', x: .20, h: .755, side: 'back', seam: true },
  { id: 'armpit', label: 'Armpit / unsafe bend', x: .48, h: .755, side: 'side' },
  { id: 'inner-thigh', label: 'Inner thigh / adjacent limb', x: .105, h: .40 },
  { id: 'hand', label: 'Hand / thin geometry', x: .95, h: .505 },
];
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const value = (id: string) => $<HTMLSelectElement>(id).value;
const checked = (id: string) => $<HTMLInputElement>(id).checked;
for (const c of cases) $<HTMLSelectElement>('scenario').add(new Option(c.label, c.id));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#1a222d');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
$('viewport').append(renderer.domElement);
const camera = new THREE.PerspectiveCamera(34, 1, .01, 100);
const raycaster = new THREE.Raycaster();
const decoder = new DRACOLoader().setDecoderPath('/draco/');
const loader = new GLTFLoader().setDRACOLoader(decoder);
const groupCache = new Map<string, THREE.Group>();
let group: THREE.Group;
let mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
let topology: ReturnType<typeof createSurfaceTopology>;
let anchor: SurfaceAnchor;
const anchorPoint = new THREE.Vector3();
const anchorNormal = new THREE.Vector3(0, 0, 1);
const anchorUV = new THREE.Vector2();
let chart: NonNullable<ReturnType<typeof buildSurfaceChart>>;
let metrics: Record<string, unknown> = {};
let overview = false;
let busy = false;
let loaded = '';
let mode = 0;
let frameTimeMs = 0;
let currentCase = cases[0];
const bounds = new THREE.Box3();
const texture = makeDesign('grid');

function makeDesign(kind: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1024;
  const c = canvas.getContext('2d')!;
  c.clearRect(0, 0, 1024, 1024);
  if (kind === 'grid') {
    c.fillStyle = '#f1e5d4'; c.fillRect(35, 35, 954, 954);
    c.strokeStyle = '#17243e'; c.lineWidth = 13;
    for (let p = 50; p <= 980; p += 115.5) {
      c.beginPath(); c.moveTo(p, 50); c.lineTo(p, 974); c.stroke();
      c.beginPath(); c.moveTo(50, p); c.lineTo(974, p); c.stroke();
    }
    c.strokeStyle = '#d32367'; c.lineWidth = 24;
    c.strokeRect(53, 53, 916, 916);
    c.beginPath(); c.arc(512, 512, 320, 0, 2 * Math.PI); c.stroke();
    c.fillStyle = '#d32367'; c.fillRect(455, 35, 114, 115);
    c.fillStyle = '#214775'; c.font = 'bold 150px Arial'; c.fillText('A', 75, 230);
    c.fillText('B', 795, 930);
  } else {
    c.fillStyle = '#182d4e';
    c.beginPath(); c.moveTo(512, 35); c.lineTo(950, 460); c.lineTo(682, 460); c.lineTo(682, 880); c.lineTo(342, 880); c.lineTo(342, 460); c.lineTo(75, 460); c.closePath(); c.fill();
    c.fillStyle = '#cf285d'; c.beginPath(); c.arc(145, 820, 75, 0, 2 * Math.PI); c.fill();
    c.fillStyle = '#f7ead8'; c.font = 'bold 118px Arial'; c.textAlign = 'center'; c.fillText('UP', 512, 525); c.fillText('INK', 512, 685);
  }
  const t = new THREE.CanvasTexture(canvas); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const material = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: {
    design: { value: texture }, mode: { value: 0 }, center: { value: new THREE.Vector2() },
    origin: { value: new THREE.Vector3() }, right: { value: new THREE.Vector3() }, up: { value: new THREE.Vector3() },
    size: { value: .4 }, aspect: { value: 1 }, rotation: { value: 0 }, uvSize: { value: .06 },
  },
  vertexShader: `attribute vec2 aTattooUv; attribute float aTattooMask;
    varying vec2 vAtlas; varying vec2 vChart; varying float vMask; varying vec3 vNormal; varying vec3 vPosition;
    void main(){vec4 world=modelMatrix*vec4(position,1.0);vAtlas=uv;vChart=aTattooUv;vMask=aTattooMask;
      vNormal=normalize(mat3(modelMatrix)*normal);vPosition=world.xyz;gl_Position=projectionMatrix*viewMatrix*world;}`,
  fragmentShader: `${TATTOO_LAYER_GLSL}\n${SURFACE_TATTOO_GLSL}
    varying vec2 vAtlas; varying vec2 vChart; varying float vMask; varying vec3 vNormal; varying vec3 vPosition;
    uniform sampler2D design; uniform int mode; uniform vec2 center; uniform vec3 origin;uniform vec3 right;uniform vec3 up;
    uniform float size;uniform float aspect;uniform float rotation;uniform float uvSize;
    void main(){ vec3 n=normalize(vNormal);float light=.40+.43*max(0.,dot(n,normalize(vec3(2.,3.,4.))))+.22*max(0.,dot(n,normalize(vec3(-3.,1.,-3.))));
      vec3 skin=vec3(.72,.57,.47);vec4 ink;
      if(mode==0)ink=sampleSurfaceTattoo(design,vChart,vMask,size,aspect,rotation,vec3(1.),1.);
      else if(mode==1)ink=sampleTattooLayer(design,vAtlas,center,uvSize,rotation);
      else {vec3 p=vPosition-origin;ink=sampleSurfaceTattoo(design,vec2(dot(p,right),dot(p,up)),1.,size,aspect,rotation,vec3(1.),1.);}
      gl_FragColor=vec4(mix(skin,ink.rgb,ink.a)*light,1.);}`,
});

async function loadModel(sex: string) {
  if (loaded === sex) return;
  $('status').textContent = `Loading ${sex} production mesh…`;
  if (group) scene.remove(group);
  let cached = groupCache.get(sex);
  if (!cached) {
    cached = (await loader.loadAsync(`/models/body_${sex}_realistic.glb`)).scene;
    groupCache.set(sex, cached);
  }
  group = cached.clone(true);
  const meshes: THREE.Mesh[] = [];
  group.traverse(o => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
  const body = meshes.reduce((a,b) => a.geometry.attributes.position.count > b.geometry.attributes.position.count ? a : b);
  for (const m of meshes) if (m !== body) m.removeFromParent();
  // Preserve face order while giving every triangle its own three mask
  // values. A shared indexed vertex cannot hide just one adjacent face.
  body.geometry = body.geometry.index ? body.geometry.toNonIndexed() : body.geometry.clone();
  body.material = material;
  mesh = body as typeof mesh;
  group.updateMatrixWorld(true);
  bounds.setFromObject(group);
  group.scale.multiplyScalar(4.2 / (bounds.max.y - bounds.min.y));
  group.updateMatrixWorld(true);
  bounds.setFromObject(group);
  group.position.sub(bounds.getCenter(new THREE.Vector3()));
  group.updateMatrixWorld(true);
  bounds.setFromObject(group);
  scene.add(group);
  const count = mesh.geometry.attributes.position.count;
  mesh.geometry.setAttribute('aTattooUv', new THREE.BufferAttribute(new Float32Array(count * 2), 2));
  mesh.geometry.setAttribute('aTattooMask', new THREE.BufferAttribute(new Float32Array(count), 1));
  topology = createSurfaceTopology(mesh.geometry);
  loaded = sex;
}

function faceIndices(face: number): number[] {
  const index = mesh.geometry.index;
  return index ? [index.getX(face*3),index.getX(face*3+1),index.getX(face*3+2)] : [face*3,face*3+1,face*3+2];
}
function worldVertex(i: number) { return new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.position,i).applyMatrix4(mesh.matrixWorld); }
function chooseAnchor(original: Case) {
  const c={...original},male=loaded==='male';
  if(c.id==='shoulder'){c.x=male?.48:.46;c.h=3.30/4.2;}
  if(c.id==='upper-arm'){c.x=male?.64:.54;c.h=2.90/4.2;}
  if(c.id==='forearm'){c.x=male?.81:.70;c.h=2.50/4.2;}
  if(c.id==='knee'){c.x=male?.365:.29;c.h=1.05/4.2;}
  if(c.id==='calf'){c.x=male?.39:.31;c.h=.65/4.2;}
  if(c.id==='ribs'){c.x=.40;c.h=2.60/4.2;}
  const y = -2.1 + c.h * 4.2;
  const target = new THREE.Vector3(c.x,y,0);
  const direction = c.side === 'back' ? new THREE.Vector3(0,0,1) : c.side === 'side' ? new THREE.Vector3(-1,0,0) : new THREE.Vector3(0,0,-1);
  const origin = target.clone().addScaledVector(direction,-5);
  // Side rays pass through the arm first: the torso target selects the closest hit to its intended point.
  raycaster.set(origin,direction);
  const hits = raycaster.intersectObject(mesh,false);
  if (!hits.length) {
    let best=.22*.22, selected=-1;
    const count=(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3;
    for(let t=0;t<count;t++){
      const ids=faceIndices(t),p=ids.map(worldVertex).reduce((a,b)=>a.add(b),new THREE.Vector3()).multiplyScalar(1/3);
      const n=ids.map(i=>new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.normal,i)).reduce((a,b)=>a.add(b),new THREE.Vector3()).normalize();
      if(n.dot(direction)>-.2)continue;
      const d=(p.x-target.x)**2+(p.y-target.y)**2;if(d<best){best=d;selected=t;}
    }
    if(selected<0)throw new Error(`No body hit for ${c.id} near ${target.toArray()}`);
    const ids=faceIndices(selected),p=ids.map(worldVertex).reduce((a,b)=>a.add(b),new THREE.Vector3()).multiplyScalar(1/3);
    hits.push({faceIndex:selected,point:p,distance:0,object:mesh});
  }
  const hit = c.side === 'side' && c.id !== 'thigh-seam' ? [...hits].sort((a,b)=>a.point.distanceToSquared(target)-b.point.distanceToSquared(target))[0] : hits[0];
  setAnchor(hit, c.seam || checked('seam'));
}

function setAnchor(hit: THREE.Intersection, snap: boolean) {
  let face = hit.faceIndex!;
  let point = hit.point.clone();
  const bary = new THREE.Vector3();
  if (snap) {
    const pos = mesh.geometry.attributes.position;
    const uv = mesh.geometry.attributes.uv;
    const map = new Map<string,number>();
    let best = Infinity, vertex = -1;
    for (let i=0;i<pos.count;i++) {
      const key = `${Math.round(pos.getX(i)*1e5)},${Math.round(pos.getY(i)*1e5)},${Math.round(pos.getZ(i)*1e5)}`;
      const old = map.get(key);
      if (old !== undefined && Math.hypot(uv.getX(old)-uv.getX(i),uv.getY(old)-uv.getY(i)) > .025 && new THREE.Vector3().fromBufferAttribute(mesh.geometry.attributes.normal,i).dot(currentCase.side==='side'?new THREE.Vector3(1,0,0):currentCase.side==='back'?new THREE.Vector3(0,0,-1):new THREE.Vector3(0,0,1))>.25) {
        const p=worldVertex(i), d=p.distanceToSquared(point);
        if(d<best){best=d;vertex=i;}
      } else map.set(key,i);
    }
    if (vertex >= 0 && best < .3*.3) {
      const triCount=(mesh.geometry.index?.count ?? pos.count)/3;
      for (let t=0;t<triCount;t++) {
        const ids=faceIndices(t), corner=ids.indexOf(vertex);
        if(corner>=0){face=t;point=worldVertex(vertex);break;}
      }
    }
  }
  const ids=faceIndices(face), verts=ids.map(worldVertex);
  THREE.Triangle.getBarycoord(point,verts[0],verts[1],verts[2],bary);
  anchor = { faceIndex: face, barycentric: [bary.x,bary.y,bary.z], bodyMeshId: `body_${loaded}_realistic` };
  anchorPoint.copy(point);
  anchorNormal.set(0,0,0);
  const normal=mesh.geometry.attributes.normal;
  ids.forEach((id,k)=>anchorNormal.addScaledVector(new THREE.Vector3().fromBufferAttribute(normal,id),bary.getComponent(k)));
  anchorNormal.transformDirection(mesh.matrixWorld).normalize();
  anchorUV.set(0,0);
  ids.forEach((id,k)=>anchorUV.addScaledVector(new THREE.Vector2().fromBufferAttribute(mesh.geometry.attributes.uv as THREE.BufferAttribute,id),bary.getComponent(k)));
}

function updateChart() {
  const start=performance.now();
  chart=buildSurfaceChart(topology,mesh.geometry,mesh.matrixWorld,anchor)??{uv:new Float32Array(mesh.geometry.attributes.position.count*2),mask:new Float32Array(mesh.geometry.attributes.position.count),faceMask:new Float32Array(mesh.geometry.attributes.position.count/3),maxSize:0,message:'Placement safely rejected: no valid local chart.'};
  frameTimeMs=performance.now()-start;
  mesh.geometry.setAttribute('aTattooUv',new THREE.BufferAttribute(chart.uv,2));
  const displayMask=chart.mask.slice();
  for(let face=0;face<chart.faceMask.length;face++) {
    if(!chart.faceMask[face]) displayMask.fill(0,face*3,face*3+3);
  }
  mesh.geometry.setAttribute('aTattooMask',new THREE.BufferAttribute(displayMask,1));
  const right=new THREE.Vector3().crossVectors(new THREE.Vector3(0,1,0),anchorNormal).normalize();
  if(right.lengthSq()<.1)right.set(1,0,0);
  const up=new THREE.Vector3().crossVectors(anchorNormal,right).normalize();
  material.uniforms.center.value.copy(anchorUV);
  material.uniforms.origin.value.copy(anchorPoint);
  material.uniforms.right.value.copy(right);
  material.uniforms.up.value.copy(up);
  updateArtwork();
}
function updateArtwork() {
  const requested=Number(value('size'));
  const aspect=Number(value('aspect'));
  const size=checked('safe') ? Math.min(requested,chart.maxSize*Math.SQRT2/Math.hypot(1,Math.min(aspect,1/aspect))) : requested;
  material.uniforms.size.value=size;
  material.uniforms.aspect.value=aspect;
  material.uniforms.rotation.value=Number(value('rotation'))*Math.PI/180;
  material.uniforms.uvSize.value=size*.2;
  metrics=measureChart(size,aspect);
  $('metrics').textContent=JSON.stringify(metrics,null,2);
  $('status').textContent=`${loaded} · ${currentCase.label} · requested ${requested.toFixed(2)} / applied ${size.toFixed(3)} / safe maximum ${chart.maxSize.toFixed(3)}${chart.message ? ` · ${chart.message}` : ''}`;
  frameCamera(); render();
}
function measureChart(size: number, aspect: number) {
  const pos=mesh.geometry.attributes.position, atlas=mesh.geometry.attributes.uv, displayMask=mesh.geometry.attributes.aTattooMask;
  const map=new Map<string,number>();let seamPairs=0,seamGap=0,maskGap=0;
  let visibleVertices=0;const ratios:number[]=[];
  const rotation=material.uniforms.rotation.value,c=Math.cos(rotation),s=Math.sin(rotation);
  const within=(i:number)=>{const x=chart.uv[i*2],y=chart.uv[i*2+1];return displayMask.getX(i)>.9 && Math.abs(c*x+s*y)<size*.5*Math.min(aspect,1) && Math.abs(-s*x+c*y)<size*.5*Math.min(1/aspect,1);};
  for(let i=0;i<pos.count;i++) {
    if(within(i))visibleVertices++;
    const key=`${Math.round(pos.getX(i)*1e5)},${Math.round(pos.getY(i)*1e5)},${Math.round(pos.getZ(i)*1e5)}`;
    const old=map.get(key);
    if(old!==undefined && Math.hypot(atlas.getX(old)-atlas.getX(i),atlas.getY(old)-atlas.getY(i))>.025 && (within(i)||within(old))) {
      seamPairs++;seamGap=Math.max(seamGap,Math.hypot(chart.uv[old*2]-chart.uv[i*2],chart.uv[old*2+1]-chart.uv[i*2+1]));maskGap=Math.max(maskGap,Math.abs(chart.mask[old]-chart.mask[i]));
    } else map.set(key,i);
  }
  const triCount=(mesh.geometry.index?.count ?? pos.count)/3;
  for(let t=0;t<triCount;t++){
    const ids=faceIndices(t);
    for(let k=0;k<3;k++){
      const a=ids[k],b=ids[(k+1)%3];if(!within(a)||!within(b))continue;
      const world=worldVertex(a).distanceTo(worldVertex(b));
      const flat=Math.hypot(chart.uv[a*2]-chart.uv[b*2],chart.uv[a*2+1]-chart.uv[b*2+1]);
      if(world>1e-6)ratios.push(flat/world);
    }
  }
  ratios.sort((a,b)=>a-b);
  return {model:loaded,case:currentCase.id,rotation:Number(value('rotation')),aspect,requestedSize:Number(value('size')),appliedSize:size,maxSize:chart.maxSize,anchor:anchorPoint.toArray(),anchorFace:anchor.faceIndex,chartMilliseconds:+frameTimeMs.toFixed(2),seamPairs,seamMaxGap:seamGap,seamMaskGap:maskGap,visibleVertices,retainedFaces:chart.faceMask.reduce((sum,keep)=>sum+keep,0),edgeScaleP05:ratios[Math.floor(ratios.length*.05)]??null,edgeScaleP50:ratios[Math.floor(ratios.length*.5)]??null,edgeScaleP95:ratios[Math.floor(ratios.length*.95)]??null,finite:Array.from(chart.uv).every(Number.isFinite)&&Array.from(chart.mask).every(Number.isFinite)&&Array.from(chart.faceMask).every(Number.isFinite),message:chart.message??null};
}
function frameCamera() {
  const width=$('viewport').clientWidth/3,height=$('viewport').clientHeight;
  camera.aspect=width/height;
  if(overview){camera.position.set(currentCase.side==='side'?5:0,.1,currentCase.side==='back'?-7:7);camera.lookAt(0,0,0);}
  else {const distance=Math.max(1.2,Number(value('size'))*2.8);camera.position.copy(anchorPoint).addScaledVector(anchorNormal,distance);camera.lookAt(anchorPoint);}
  camera.updateProjectionMatrix();
}
function render() {
  if(!mesh)return;
  const width=$('viewport').clientWidth,height=$('viewport').clientHeight;
  renderer.setSize(width,height,false);
  renderer.setScissorTest(true);
  for(mode=0;mode<3;mode++){
    const left=Math.floor(width*mode/3),next=Math.floor(width*(mode+1)/3);
    renderer.setViewport(left,0,next-left,height);renderer.setScissor(left,0,next-left,height);
    material.uniforms.mode.value=mode;renderer.render(scene,camera);
  }
  renderer.setScissorTest(false);
}
async function setScenario(options: Record<string,string|number|boolean>={}) {
  for(const [key,v]of Object.entries(options)){
    const el=document.getElementById(key) as HTMLInputElement|HTMLSelectElement|null;
    if(el){if(typeof v==='boolean')(el as HTMLInputElement).checked=v;else el.value=String(v);}
  }
  await loadModel(value('model'));
  currentCase=cases.find(c=>c.id===value('scenario'))??cases[0];
  chooseAnchor(currentCase);updateChart();
  return metrics;
}
async function runSuite() {
  if(busy)return;busy=true;$<HTMLButtonElement>('suite').disabled=true;
  const results:Record<string,unknown>[]=[];const failures:string[]=[];
  $('sheet').innerHTML='';
  const jobs:Record<string,string|number|boolean>[]=[];
  for(const model of ['male','female'])for(const c of cases)jobs.push({model,scenario:c.id,size:.4,rotation:0,aspect:1,safe:true,design:'grid'});
  for(const model of ['male','female'])for(const rotation of [45,90,180])for(const aspect of [.45,2.2])jobs.push({model,scenario:'shoulder',size:.4,rotation,aspect,safe:true,design:'arrow'});
  for(const model of ['male','female'])for(const size of [.12,.8,1.2])jobs.push({model,scenario:'forearm',size,rotation:45,aspect:1,safe:true,design:'grid'});
  for(let i=0;i<jobs.length;i++) {
    const job=jobs[i];$('suiteSummary').textContent=`Rendering ${i+1} / ${jobs.length} cases…`;
    try {
      material.uniforms.design.value=makeDesign(String(job.design));
      await setScenario(job);overview=false;frameCamera();render();
      const c=document.createElement('canvas');c.width=420;c.height=420;
      const source=renderer.domElement;
      c.getContext('2d')!.drawImage(source,0,0,source.width/3,source.height,0,0,420,420);
      const image=c.toDataURL('image/png');
      const item={...metrics};results.push(item);
      if(!item.finite || Number(item.seamMaxGap)>1e-4 || Number(item.seamMaskGap)>1e-4) failures.push(`${job.model}/${job.scenario}: continuity or finite check failed`);
      const card=document.createElement('div');card.className='card';
      const img=document.createElement('img');img.src=image;img.alt=`${job.model} ${currentCase.label}, ${job.rotation} degrees, aspect ${job.aspect}, requested size ${job.size}`;card.append(img);
      const p=document.createElement('p');p.textContent=`${job.model} · ${currentCase.label} · ${job.rotation}° · aspect ${job.aspect}`;card.append(p);
      const q=document.createElement('p');q.textContent=`Size ${Number(item.appliedSize).toFixed(2)} / ${job.size}; seam pairs ${item.seamPairs}; edge scale ${Number(item.edgeScaleP05).toFixed(2)}–${Number(item.edgeScaleP95).toFixed(2)}`;card.append(q);
      if(item.message){const w=document.createElement('p');w.className='warning';w.textContent=String(item.message);card.append(w);}
      $('sheet').append(card);
    }catch(error){failures.push(`${job.model}/${job.scenario}: ${error}`);results.push({...job,error:String(error)});}
    await new Promise(resolve=>setTimeout(resolve,12));
  }
  const report={generatedAt:new Date().toISOString(),cases:results.length,failures,results};
  $('suiteSummary').textContent=`Completed ${results.length} cases. ${failures.length} failed continuity / finite / placement checks.\n${failures.join('\n')}`;
  const download=$<HTMLAnchorElement>('download');download.href=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));download.download='placement-visual-results.json';download.style.display='inline';
  (window as unknown as {placementLab:Record<string,unknown>}).placementLab.report=report;
  busy=false;$<HTMLButtonElement>('suite').disabled=false;
  return report;
}
function fail(error:unknown){$('error').textContent=String(error instanceof Error ? error.stack : error);console.error(error);}
for(const id of ['model','scenario','seam'])$(id).addEventListener('change',()=>setScenario().catch(fail));
for(const id of ['rotation','size','aspect','safe'])$(id).addEventListener('change',()=>{try{updateArtwork();}catch(e){fail(e);}});
$('design').addEventListener('change',()=>{material.uniforms.design.value=makeDesign(value('design'));render();});
$('overview').addEventListener('click',()=>{overview=true;frameCamera();render();});
$('closeup').addEventListener('click',()=>{overview=false;frameCamera();render();});
$('suite').addEventListener('click',()=>runSuite().catch(fail));
renderer.domElement.addEventListener('pointerdown',event=>{
  const r=renderer.domElement.getBoundingClientRect(),panel=r.width/3;
  const x=((event.clientX-r.left)%panel)/panel*2-1,y=1-(event.clientY-r.top)/r.height*2;
  raycaster.setFromCamera(new THREE.Vector2(x,y),camera);
  const hit=raycaster.intersectObject(mesh,false)[0];if(hit){setAnchor(hit,checked('seam'));updateChart();}
});
window.addEventListener('resize',()=>{frameCamera();render();});
(window as unknown as {placementLab:Record<string,unknown>}).placementLab={setScenario,runSuite,getMetrics:()=>metrics,cases,ready:false};
setScenario().then(()=>{(window as unknown as {placementLab:Record<string,unknown>}).placementLab.ready=true;}).catch(fail);
