import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import * as THREE from 'three';
import {loadBodyPreview} from './body-shape-visual-loader.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const bundle=await build({stdin:{contents:"export * from './src/render/previewEyes';export * from './src/render/previewAppearance';export * from './src/render/bodyShape';export * from './src/render/bodyPose';",resolveDir:root},bundle:true,write:false,platform:'node',format:'esm'});
const api=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
for(const sex of ['male','female']){
 const body=new THREE.Mesh((await loadBodyPreview(root,sex)).geometry);
 const sources=await Promise.all([1,2].map(async rank=>new THREE.Mesh((await loadBodyPreview(root,sex,rank)).geometry)));
 const originals=sources.map(m=>m.geometry.attributes.position.array.slice());
 const eyes=api.createPreviewEyes(sources,body);assert.equal(eyes.children.length,2);
 const bodyD=api.prepareDeformable(body.geometry),bounds=api.shapeBounds([bodyD]);
 const eyeD=eyes.children.map(e=>api.prepareDeformable(e.geometry)),items=[bodyD,...eyeD];
 for(const headTurn of [-35,0,35])for(const headTilt of [-15,0,15])for(const height of [-1,0,1]){
  api.applyBodyShape(items,bounds,api.normalizeShape({height}));api.applyBodyPose(items,bounds,{headTurn,headTilt});
  for(const d of eyeD)assert.ok(d.geometry.attributes.position.array.every(Number.isFinite));
  const first=eyeD.map(d=>d.geometry.attributes.position.array.slice());
  api.applyBodyShape(items,bounds,api.normalizeShape({height}));api.applyBodyPose(items,bounds,{headTurn,headTilt});
  eyeD.forEach((d,i)=>assert.deepEqual(d.geometry.attributes.position.array,first[i],'no compounded eye deformation'));
 }
 for(const eye of eyes.children){assert.equal(api.appearanceHit(eye),'eyes');assert.ok(eye.geometry.getAttribute('aEyeDirection'));}
 eyes.visible=false;assert.equal(api.appearanceHit(eyes.children[0]),'hidden');
 sources.forEach((m,i)=>assert.deepEqual(m.geometry.attributes.position.array,originals[i],'cached GLB untouched'));
 api.disposeAppearance(eyes);
}
console.log('Eyes passed: both real GLBs, 54 shape/head poses, stable coordinates, immutable source meshes and blocked tattoo picking.');
