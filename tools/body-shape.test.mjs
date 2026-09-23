/** Actual GLB / production implementation regression. Run: node tools/body-shape.test.mjs */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {loadBodyPreview,bodyShapeCases} from './body-shape-visual-loader.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const temporary=path.join(os.tmpdir(),`smartink-body-${process.pid}.mjs`);
await build({entryPoints:[path.join(root,'src/render/bodyShape.ts')],outfile:temporary,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const shape=await import(pathToFileURL(temporary));await fs.unlink(temporary);
const {normalizeShape,clampShapeValue,effectiveShape,DEFAULT_BODY_SHAPE,BODY_SHAPE_KEYS,prepareDeformable,shapeBounds,applyBodyShape}=shape;
for(const key of BODY_SHAPE_KEYS){
 assert.equal(clampShapeValue(key,Infinity),0,`${key}: invalid input resets safely`);
 assert.equal(clampShapeValue(key,NaN),0);assert.equal(clampShapeValue(key,100),1);assert.equal(clampShapeValue(key,-100),-1);
 assert.equal(normalizeShape({[key]:100})[key],1);assert.equal(normalizeShape({[key]:-100})[key],-1);
}
assert.deepEqual(normalizeShape(null),DEFAULT_BODY_SHAPE);
const malformed={height:Infinity,build:NaN,arms:-100,legs:100};const saved={...malformed};
assert.deepEqual(effectiveShape(malformed),normalizeShape(malformed));assert.deepEqual(malformed,saved,'normalization never mutates saved input');
let seed=0x20260923;function random(){seed=(Math.imul(1664525,seed)+1013904223)>>>0;return seed/2**32;}
const cases=bodyShapeCases(shape);
for(let i=0;i<64;i++)cases.push({id:`seeded-${i}`,values:Object.fromEntries(BODY_SHAPE_KEYS.map(k=>[k,i<32?(random()<.5?-1:1):random()*2-1]))});

function normals(positions,indices){
 const result=new Float64Array(indices.length);
 for(let t=0;t<indices.length;t+=3){const a=indices[t]*3,b=indices[t+1]*3,c=indices[t+2]*3;
  const bx=positions[b]-positions[a],by=positions[b+1]-positions[a+1],bz=positions[b+2]-positions[a+2];
  const cx=positions[c]-positions[a],cy=positions[c+1]-positions[a+1],cz=positions[c+2]-positions[a+2];
  result[t]=by*cz-bz*cy;result[t+1]=bz*cx-bx*cz;result[t+2]=bx*cy-by*cx;
 }return result;
}
function faceQuality(baseNormals,changedNormals,minArea){
 let reversed=0,collapsed=0,worst=Infinity;
 for(let t=0;t<baseNormals.length;t+=3){
  const a=Math.hypot(baseNormals[t],baseNormals[t+1],baseNormals[t+2]);if(a<minArea)continue;
  const b=Math.hypot(changedNormals[t],changedNormals[t+1],changedNormals[t+2]),ratio=b/a;worst=Math.min(worst,ratio);
  const dot=baseNormals[t]*changedNormals[t]+baseNormals[t+1]*changedNormals[t+1]+baseNormals[t+2]*changedNormals[t+2];
  if(dot < -1e-6*a*b)reversed++;
  if(ratio<.05)collapsed++;
 }return {reversed,collapsed,worst};
}
function translationFreeError(base,changed,selection){
 const first=selection[0]*3,offset=[0,1,2].map(a=>changed[first+a]-base[first+a]);let worst=0;
 for(const i of selection)for(let a=0;a<3;a++)worst=Math.max(worst,Math.abs((changed[i*3+a]-base[i*3+a])-offset[a]));
 return worst;
}
function crossSectionDepth(positions,selection){let lo=Infinity,hi=-Infinity;for(const i of selection){lo=Math.min(lo,positions[i*3+2]);hi=Math.max(hi,positions[i*3+2]);}return hi-lo;}

const timings=[];let tested=0;
for(const sex of ['male','female']){
 const fixture=await loadBodyPreview(root,sex);
 // Match ModelWithUVTattoo: each face has separate corners for tattoo masks.
 const geometry=fixture.geometry.toNonIndexed();fixture.geometry.dispose();
 const indices=Uint32Array.from({length:geometry.attributes.position.count},(_,i)=>i);
 const deformable=prepareDeformable(geometry),bounds=shapeBounds([deformable]),base=deformable.base;
 const H=bounds.maxY-bounds.minY,cx=(bounds.minX+bounds.maxX)/2,halfW=(bounds.maxX-bounds.minX)/2;
 const baseNormals=normals(base,indices),first=new Map(),pairs=[];
 const subsets={head:[],rightHand:[],feet:[],upperArm:[],forearm:[]};
 for(let i=0;i<base.length/3;i++){
  const x=base[i*3],h=(base[i*3+1]-bounds.minY)/H,u=(x-cx)/halfW;
  if(h>.91)subsets.head.push(i);if(h<.50&&u>.82)subsets.rightHand.push(i);if(h<.065)subsets.feet.push(i);
  if(Math.abs(h-.70)<.008&&u>.48)subsets.upperArm.push(i);if(Math.abs(h-.58)<.008&&u>.55)subsets.forearm.push(i);
  const key=`${base[i*3]},${base[i*3+1]},${base[i*3+2]}`,previous=first.get(key);if(previous!==undefined)pairs.push([previous,i]);else first.set(key,i);
 }
 for(const [name,ids]of Object.entries(subsets))assert.ok(ids.length>10,`${sex} meaningful ${name} fixture`);
 assert.ok(pairs.length>100,`${sex}: real atlas seam duplicates present`);
 const thickness={};
 for(const spec of cases){
  const values=normalizeShape(spec.values),start=performance.now();applyBodyShape([deformable],bounds,values);timings.push(performance.now()-start);
  const changed=geometry.attributes.position.array;
  assert.ok(changed.every(Number.isFinite),`${sex}/${spec.id}: finite positions`);
  assert.ok(geometry.attributes.normal.array.every(Number.isFinite),`${sex}/${spec.id}: finite shading normals`);
  const quality=faceQuality(baseNormals,normals(changed,indices),H*H*1e-12);
  assert.equal(quality.reversed,0,`${sex}/${spec.id}: reversed faces; values=${JSON.stringify(spec.values)}`);
  assert.equal(quality.collapsed,0,`${sex}/${spec.id}: triangles collapsed below 5% area`);
  for(const [a,b]of pairs)for(let axis=0;axis<3;axis++)assert.equal(changed[a*3+axis],changed[b*3+axis],`${sex}/${spec.id}: welded seam remains closed`);
  if(spec.id==='arms-min'||spec.id==='arms-max')thickness[spec.id]=Object.fromEntries(['upperArm','forearm'].map(part=>[part,crossSectionDepth(changed,subsets[part])/crossSectionDepth(base,subsets[part])]));
  // Local controls and Build must retain detailed extremities, allowing uniform
  // translation when shoulders carry the whole arm. Height/head/leg length are deliberate exceptions.
  const keys=Object.keys(spec.values);
  if(keys.length===1&&!['height','head','legLength'].includes(keys[0]))for(const part of ['head','rightHand','feet']){
   assert.ok(translationFreeError(base,changed,subsets[part])<H*2e-6,`${sex}/${spec.id}: ${part} internal shape must be preserved`);
  }
  tested++;
 }
 for(const part of ['upperArm','forearm']){
  assert.ok(thickness['arms-min'][part]<.95,`${sex}: arms minimum visibly narrows ${part}`);
  assert.ok(thickness['arms-max'][part]>1.05,`${sex}: arms maximum visibly widens ${part}`);
 }
 // A long sequence of edits must not accumulate or corrupt the exact default.
 applyBodyShape([deformable],bounds,DEFAULT_BODY_SHAPE);assert.deepEqual(geometry.attributes.position.array,base,`${sex}: exact reset after all edits`);
 const target=normalizeShape({build:.7,arms:-.6,waist:.4});applyBodyShape([deformable],bounds,target);const once=geometry.attributes.position.array.slice();
 applyBodyShape([deformable],bounds,normalizeShape({height:-1,legs:1}));applyBodyShape([deformable],bounds,target);
 assert.deepEqual(geometry.attributes.position.array,once,`${sex}: deterministic non-compounding edits`);
 console.log(`${sex}: ${cases.length} real-mesh shapes passed; arm depth range upper ${thickness['arms-min'].upperArm.toFixed(2)}–${thickness['arms-max'].upperArm.toFixed(2)}, forearm ${thickness['arms-min'].forearm.toFixed(2)}–${thickness['arms-max'].forearm.toFixed(2)}`);
 geometry.dispose();
}
timings.sort((a,b)=>a-b);
console.log(`Body shape: ${tested} cases, no reversed/collapsed triangles; exact reset, seam continuity, preservation and clamping passed. Deform p50=${timings[Math.floor(timings.length*.5)].toFixed(1)}ms p95=${timings[Math.floor(timings.length*.95)].toFixed(1)}ms.`);
