/** Actual garment geometry on the shipped GLBs; no browser or shader substitute. */
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';import * as THREE from 'three';import {loadPoseModules,poseFixture,applyPoseCase,root} from './body-pose-visual-lib.mjs';
const tmp=path.join(os.tmpdir(),`clothing-${process.pid}.mjs`);await build({stdin:{contents:"export * from './src/render/previewClothing';export * from './src/render/bodyAppearance';",resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',outfile:tmp,logLevel:'silent'});const cloth=await import(pathToFileURL(tmp));await fs.unlink(tmp);
const modules=await loadPoseModules(),out=path.join(root,'reports/clothing',process.argv[2]??'first');await fs.mkdir(out,{recursive:true});const specs=[];
for(const sex of ['male','female']){
 const fixture=await poseFixture(sex,modules);
 for(const [name,values,pose,bottom] of [['neutral',{}, {},'trousers'],['shorts',{}, {},'shorts'],['arms-out',{},modules.pose.poseFromPreset('arms_out'),'trousers'],['step-heavy',modules.shape.BODY_SHAPE_PRESETS.find(p=>p.id==='heavy').values,modules.pose.poseFromPreset('step'),'trousers'],['max-flex',Object.fromEntries(modules.shape.BODY_SHAPE_KEYS.map(k=>[k,1])),modules.pose.poseFromPreset('flex'),'shorts'],['min-step',Object.fromEntries(modules.shape.BODY_SHAPE_KEYS.map(k=>[k,-1])),modules.pose.poseFromPreset('step'),'trousers']]){
  const id=`${sex}-${name}`,shaped=applyPoseCase(fixture,modules,{shape:values,pose}),appearance={...cloth.DEFAULT_BODY_APPEARANCE,top:'tshirt',bottom};
  const begin=performance.now(),garments=cloth.createClothing(fixture.geometry,fixture.prepared.base,fixture.bounds,appearance,shaped),ms=performance.now()-begin;
  const coverage=cloth.createClothingCoverage(fixture.prepared.base,fixture.bounds,appearance),body=fixture.geometry.clone().applyMatrix4(fixture.matrix);body.computeBoundingBox();const center=body.boundingBox.getCenter(new THREE.Vector3());body.translate(-center.x,-center.y,-center.z);
  const meshes=[{geometry:body,color:new THREE.Color().setRGB(.72,.56,.45,THREE.SRGBColorSpace).toArray(),coverage}];garments.traverse(o=>{if(o.isMesh){const geometry=o.geometry.clone().applyMatrix4(fixture.matrix);geometry.translate(-center.x,-center.y,-center.z);meshes.push({geometry,color:o.material.color.toArray(),coverage:null});}});
  const data={id,ms,meshes:[]};for(let i=0;i<meshes.length;i++){
   const m=meshes[i],g=m.geometry,p=g.attributes.position.array,n=g.attributes.normal.array,ix=g.index?.array??Uint32Array.from({length:p.length/3},(_,i)=>i);
   for(const [kind,array] of [['positions',p],['normals',n],['indices',Uint32Array.from(ix)],...(m.coverage?[['coverage',m.coverage]]:[])])await fs.writeFile(path.join(out,`${id}-${i}-${kind}.${kind==='indices'?'u32':'f32'}`),new Uint8Array(array.buffer,array.byteOffset,array.byteLength));
   data.meshes.push({i,color:m.color,coverage:!!m.coverage});g.dispose();
  }specs.push(data);console.log(id,ms.toFixed(1)+'ms');garments.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});
 }
 fixture.geometry.dispose();
}
await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(specs));console.log(out);
