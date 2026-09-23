/** Actual-GLB Focus regression + offline evidence, using production masks/camera. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
import * as THREE from 'three';
import {loadBodyPreview} from './body-shape-visual-loader.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),stageIndex=process.argv.indexOf('--stage');
const stage=stageIndex>=0?process.argv[stageIndex+1]:'final',out=path.join(root,'reports/focus',stage);await fs.mkdir(out,{recursive:true});
const tmp=path.join(os.tmpdir(),`smartink-focus-${process.pid}.mjs`);
await build({stdin:{contents:"export * as regions from './src/render/bodyRegions.ts';export * as mask from './src/render/bodyRegionMask.ts';export * as camera from './src/render/focusCamera.ts';export * as focusGeometry from './src/render/focusGeometry.ts';export * as shape from './src/render/bodyShape.ts';export * as pose from './src/render/bodyPose.ts';",resolveDir:root,loader:'ts'},outfile:tmp,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
const mod=await import(pathToFileURL(tmp));await fs.unlink(tmp);
const hash=crypto.createHash('sha256');for(const name of ['bodyRegionMask','focusCamera','focusGeometry','bodyRegions','bodyShape','bodyPose']){const source=await fs.readFile(path.join(root,`src/render/${name}.ts`));hash.update(source);await fs.writeFile(path.join(out,`${name}.ts`),source);}
const report={sourceSha:hash.digest('hex'),note:'CPU rendering of actual GLB geometry with production signed region masks. Baseline reproduces old scalar category interpolation and bounding-sphere camera; candidate uses production camera fit. Global Y up, real A-pose diagonal preserved.',regions:mod.regions.REGION_INDEX,figures:[],cases:[],cameraFits:0,maxProjectedNdc:0};
function oldCamera(framing,direction,fov,aspect){const vertical=THREE.MathUtils.degToRad(fov)/2,horizontal=Math.atan(Math.tan(vertical)*Math.max(.1,aspect));const distance=framing.radius/Math.sin(Math.min(vertical,horizontal))*1.15;return{position:new THREE.Vector3(...direction).normalize().multiplyScalar(distance).add(new THREE.Vector3(...framing.center)).toArray(),target:[...framing.center],fov};}
function checkFrame(framing,direction,fov,aspect){const result=mod.camera.fitRegionCamera(framing,direction,fov,aspect),camera=new THREE.PerspectiveCamera(fov,aspect,.01,100);camera.position.fromArray(result.position);camera.lookAt(...result.target);camera.updateMatrixWorld(true);const v=new THREE.Vector3();for(let i=0;i<framing.points.length;i+=3){v.fromArray(framing.points,i).project(camera);assert.ok(Number.isFinite(v.x)&&Number.isFinite(v.y)&&Math.abs(v.x)<=1/1.15+.0001&&Math.abs(v.y)<=1/1.15+.0001,'Visible point outside padded frame');report.maxProjectedNdc=Math.max(report.maxProjectedNdc,Math.abs(v.x),Math.abs(v.y));}report.cameraFits++;return result;}
async function write(name,data){await fs.writeFile(path.join(out,name),Buffer.from(data.buffer,data.byteOffset,data.byteLength));}
for(const sex of ['male','female']){
 const {geometry,matrix,indices}=await loadBodyPreview(root,sex),prepared=mod.shape.prepareDeformable(geometry),bounds=mod.shape.shapeBounds([prepared]),base=prepared.base;
 const frame=mod.regions.regionFrame(bounds),masks=mod.mask.createRegionMasks(base,bounds);
 const labels=Float32Array.from({length:base.length/3},(_,i)=>mod.regions.REGION_INDEX[mod.regions.classifyPoint(base[i*3],base[i*3+1],frame)]);
 const phantom={},boundary=[];
 for(let f=0;f<indices.length/3;f++){const ls=Array.from(indices.subarray(f*3,f*3+3),i=>labels[i]);if(new Set(ls).size>1)boundary.push(f);for(const[name,want]of Object.entries(mod.regions.REGION_INDEX))if(!ls.includes(want)&&Math.max(...ls)>want-.5&&Math.min(...ls)<want+.5)phantom[name]=(phantom[name]||0)+1;}
 const figure={sex,triangles:indices.length/3,boundaryTriangles:boundary.length,phantomTrianglesByFocusedRegion:phantom,fingers:{}};
 for(const name of Object.keys(masks)){assert.equal(masks[name].length,base.length/3);assert.ok(masks[name].every(Number.isFinite));await write(`${sex}-mask-${name}.f32`,masks[name]);}
 const seen=new Map();for(let i=0;i<base.length/3;i++){const key=`${base[i*3]},${base[i*3+1]},${base[i*3+2]}`,previous=seen.get(key);if(previous!==undefined)for(const name of Object.keys(masks))assert.equal(masks[name][i],masks[name][previous],`${name} mask seam mismatch`);else seen.set(key,i);}
 for(const [region,sign]of [['armLeft',1],['armRight',-1]]){let count=0,hidden=0,oldHidden=0;for(let i=0;i<base.length/3;i++){const h=(base[i*3+1]-frame.minY)/frame.height,u=(base[i*3]-frame.centerX)/frame.halfWidth;if(h<.50&&u*sign>.82){count++;if(masks[region][i]<0)hidden++;if(labels[i]!==mod.regions.REGION_INDEX[region])oldHidden++;}}figure.fingers[region]={sampleVertices:count,hidden,oldHidden};assert.equal(hidden,0,`${sex} ${region} distal fingers cut`);}
 await write(`${sex}-labels.f32`,labels);await write(`${sex}-indices.u32`,indices);report.figures.push(figure);
 const extremes=Object.fromEntries(mod.shape.BODY_SHAPE_KEYS.map(k=>[k,1])),mins=Object.fromEntries(mod.shape.BODY_SHAPE_KEYS.map(k=>[k,-1]));
 const cases=[{id:'neutral',pose:{}},{id:'arms-out',pose:mod.pose.poseFromPreset('arms_out')},{id:'flex',pose:mod.pose.poseFromPreset('flex')},{id:'step',pose:mod.pose.poseFromPreset('step')},{id:'shape-max-arms-out',shape:extremes,pose:mod.pose.poseFromPreset('arms_out')},{id:'shape-min-flex',shape:mins,pose:mod.pose.poseFromPreset('flex')},{id:'opposing',pose:{leftArmLift:40,rightArmLift:-10,leftArmForward:-10,rightArmForward:35,leftElbow:85,rightElbow:85,leftLegForward:30,rightLegForward:-15,leftKnee:55,rightKnee:0,headTurn:35,headTilt:-15}}];
 for(const spec of cases){
  mod.shape.applyBodyShape([prepared],bounds,mod.shape.normalizeShape(spec.shape));mod.pose.applyBodyPose([prepared],bounds,mod.pose.normalizePose(spec.pose));
  const world=geometry.clone().applyMatrix4(matrix);world.computeBoundingBox();const center=world.boundingBox.getCenter(new THREE.Vector3());world.translate(-center.x,-center.y,-center.z);const pos=world.attributes.position.array;
  const id=`${sex}-${spec.id}`,entry={id,sex,case:spec.id,framing:{}};await write(`${id}-positions.f32`,pos);await write(`${id}-normals.f32`,world.attributes.normal.array);
  for(const name of Object.keys(masks)){
   const oldPoints=[];for(let i=0;i<labels.length;i++)if(labels[i]===mod.regions.REGION_INDEX[name])oldPoints.push(pos[i*3],pos[i*3+1],pos[i*3+2]);const oldFrame=mod.focusGeometry.framingFromPoints(Float32Array.from(oldPoints));assert.ok(oldFrame);
   const points=mod.focusGeometry.visibleRegionPoints(world,new THREE.Matrix4(),masks[name]);const framing=mod.focusGeometry.framingFromPoints(points);assert.ok(framing);
   for(const aspect of [400/480,.45,2.2])for(const direction of [[0,0,1],[0,0,-1],[1,0,0],[-1,0,0],[1,0,1],[0,1,0],[0,-1,0]])checkFrame(framing,direction,45,aspect);
   entry.framing[name]={old:oldCamera(oldFrame,[6,4,6],45,400/480),front:oldCamera(oldFrame,[0,0,1],45,400/480),signed:mod.camera.fitRegionCamera(framing,[0,0,1],45,400/480),side:mod.camera.fitRegionCamera(framing,[name.endsWith('Right')?-1:1,0,0],45,400/480)};
  }
  world.dispose();report.cases.push(entry);
 }
 geometry.dispose();
}
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({cameraFits:report.cameraFits,maxProjectedNdc:report.maxProjectedNdc,figures:report.figures,sourceSha:report.sourceSha},null,2));
if(!process.argv.includes('--audit-only')){const child=spawnSync(process.env.FOCUS_PYTHON||'python3',[path.join(root,'tools/focus-visual.py'),out],{stdio:'inherit'});process.exitCode=child.status??1;}
