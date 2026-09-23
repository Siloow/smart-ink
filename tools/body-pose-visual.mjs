/** Render actual posed GLBs without a browser. Python needs NumPy + Pillow.
 * BODY_POSE_PYTHON=/path/to/python node tools/body-pose-visual.mjs --stage first
 * --quick renders presets/stress poses only; --audit-only skips images.
 */
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import * as THREE from 'three';
import {root,loadPoseModules,poseCases,poseFixture,applyPoseCase,worldArrays} from './body-pose-visual-lib.mjs';
const args=process.argv.slice(2),stage=args.includes('--stage')?args[args.indexOf('--stage')+1]:'current';
if(!/^[a-z0-9-]+$/i.test(stage))throw Error('Invalid stage');
const out=path.join(root,'reports/body-pose',stage);fs.mkdirSync(out,{recursive:true});
if(!args.includes('--render-only')){
 const modules=await loadPoseModules(),cases=poseCases(modules),manifest={stage,sourceSha:modules.sourceSha,generatedAt:new Date().toISOString(),cases:[]};
 fs.copyFileSync(path.join(root,'src/render/bodyPose.ts'),path.join(out,'bodyPose.ts'));fs.copyFileSync(path.join(root,'src/render/bodyShape.ts'),path.join(out,'bodyShape.ts'));
 for(const sex of ['male','female']){
  const fixture=await poseFixture(sex,modules),v=new THREE.Vector3();
  fs.writeFileSync(path.join(out,`${sex}-indices.u32`),Buffer.from(fixture.indices.buffer));
  fs.writeFileSync(path.join(out,`${sex}-tattoo-uv.f32`),Buffer.from(fixture.uv.buffer));fs.writeFileSync(path.join(out,`${sex}-tattoo-mask.f32`),Buffer.from(fixture.mask.buffer));
  for(const spec of cases){
   const started=performance.now(),shaped=applyPoseCase(fixture,modules,spec),milliseconds=performance.now()-started,arrays=worldArrays(fixture),id=`${sex}-${spec.id}`;
   for(let i=0;i<shaped.length;i+=3)v.fromArray(shaped,i).applyMatrix4(fixture.matrix).toArray(shaped,i);
   fs.writeFileSync(path.join(out,`${id}-shaped.f32`),Buffer.from(shaped.buffer));
   for(const kind of ['positions','normals'])fs.writeFileSync(path.join(out,`${id}-${kind}.f32`),Buffer.from(arrays[kind].buffer));
   manifest.cases.push({...spec,id,case:spec.id,sex,pose:modules.pose.normalizePose(spec.pose),shape:modules.shape.normalizeShape(spec.shape),dimensions:arrays.dimensions,milliseconds,anchors:fixture.anchors});
  }
  console.log(`${sex}: generated ${cases.length} actual pose cases`);
 }
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
}
const selected=args.includes('--case')?['--case',args[args.indexOf('--case')+1]]:[];
const result=spawnSync(process.env.BODY_POSE_PYTHON||'python3',[path.join(root,'tools/body-pose-visual.py'),out,...args.filter(a=>['--quick','--audit-only','--gallery-only'].includes(a)),...selected],{cwd:root,stdio:'inherit'});
process.exitCode=result.status??1;
