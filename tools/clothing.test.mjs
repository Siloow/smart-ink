/** Production garments on actual male/female GLBs, including shaped and posed cases. */
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';import {build} from 'esbuild';import {loadPoseModules,poseFixture,applyPoseCase,root} from './body-pose-visual-lib.mjs';
const file=path.join(os.tmpdir(),`clothing-test-${process.pid}.mjs`);await build({stdin:{contents:"export * from './src/render/previewClothing';export * from './src/render/bodyAppearance';",resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',outfile:file,logLevel:'silent'});const api=await import(pathToFileURL(file));await fs.unlink(file);const modules=await loadPoseModules();let count=0;const timings=[];
function components(geometry){const ix=geometry.index.array,adj=Array.from({length:geometry.attributes.position.count},()=>[]);for(let i=0;i<ix.length;i+=3)for(let k=0;k<3;k++)adj[ix[i+k]].push(ix[i+(k+1)%3],ix[i+(k+2)%3]);const seen=new Set();let n=0;for(let i=0;i<adj.length;i++)if(!seen.has(i)&&adj[i].length){n++;const stack=[i];seen.add(i);while(stack.length){for(const j of adj[stack.pop()])if(!seen.has(j)){seen.add(j);stack.push(j);}}}return n;}
function release(group){group.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});}
for(const sex of ['male','female']){
 const fixture=await poseFixture(sex,modules),base=fixture.prepared.base;
 const poses=[['neutral',{}],...modules.pose.BODY_POSE_PRESETS.filter(p=>p.id!=='neutral').map(p=>[p.id,p.values])];
 for(const [name,pose]of poses)for(const strength of (name==='neutral'||name==='flex'||name==='step'?[-1,0,1]:[0])){
  const shaped=applyPoseCase(fixture,modules,{pose,shape:Object.fromEntries(modules.shape.BODY_SHAPE_KEYS.map(k=>[k,strength]))});
  const before=Object.fromEntries(Object.entries(fixture.geometry.attributes).map(([k,v])=>[k,v.array.slice()]));
  for(const bottom of ['shorts','trousers']){
   const appearance={...api.DEFAULT_BODY_APPEARANCE,top:'tshirt',bottom};const start=performance.now();const group=api.createClothing(fixture.geometry,base,fixture.bounds,appearance,shaped);timings.push(performance.now()-start);
   assert.equal(group.userData.previewAppearance,'clothing');assert.equal(group.children.length,2);
   for(const garment of group.children){const mesh=garment.children[0],hem=garment.children[1];assert.ok(mesh.geometry.index.count>300);assert.ok(hem.geometry.index.count>50);assert.equal(components(mesh.geometry),1,`${sex}/${name}/${strength}: no detached garment scraps`);assert.ok(mesh.material.isMeshStandardMaterial);assert.ok(mesh.material.roughness>.8);
    for(const item of [mesh,hem])for(const a of Object.values(item.geometry.attributes))assert.ok(a.array.every(Number.isFinite),'finite cloth positions/normals');
   }
   const coverage=api.createClothingCoverage(base,fixture.bounds,appearance);assert.equal(coverage.length,base.length/3);assert.ok(coverage.some(v=>v>0));
   const top=api.createClothingCoverage(base,fixture.bounds,{...appearance,bottom:'none'}),lower=api.createClothingCoverage(base,fixture.bounds,{...appearance,top:'none'});
   for(let i=0;i<coverage.length;i++){assert.equal(coverage[i],Math.max(top[i],lower[i]));const h=(base[i*3+1]-fixture.bounds.minY)/(fixture.bounds.maxY-fixture.bounds.minY);if(h>.90||h<.075)assert.ok(coverage[i]<0,'face and feet remain exposed');}
   for(let f=0;f<coverage.length/3;f+=131){const bary=[.2,.3,.5];assert.equal(api.clothingCoversTriangle(coverage,f,bary),coverage[f*3]*.2+coverage[f*3+1]*.3+coverage[f*3+2]*.5>=0);}
   if(name==='neutral'&&strength===0){const repeat=api.createClothing(fixture.geometry,base,fixture.bounds,appearance,shaped);assert.deepEqual(repeat.children[0].children[0].geometry.attributes.position.array,group.children[0].children[0].geometry.attributes.position.array,'deterministic regeneration');release(repeat);}
   release(group);count++;
  }
  for(const [key,array]of Object.entries(before))assert.deepEqual(fixture.geometry.attributes[key].array,array,`clothing never edits body ${key}`);
 }
 const empty=api.createClothing(fixture.geometry,base,fixture.bounds,api.DEFAULT_BODY_APPEARANCE);assert.equal(empty.children.length,0);assert.ok(api.createClothingCoverage(base,fixture.bounds,api.DEFAULT_BODY_APPEARANCE).every(v=>v<0));fixture.geometry.dispose();
}
assert.equal(api.clothingCoversTriangle(new Float32Array(3),-1,[1,0,0]),false);
timings.sort((a,b)=>a-b);console.log(`Clothing passed ${count} real body/shape/pose/outfit cases: finite connected fabric, real hems, stable coverage/picking, deterministic rebuild, unchanged body+UV/tattoo. Generation median ${timings[Math.floor(timings.length*.5)].toFixed(1)} ms; p95 ${timings[Math.floor(timings.length*.95)].toFixed(1)} ms.`);
