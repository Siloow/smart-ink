/** Rebuild the production body-shape module, decode the real GLBs, audit and CPU-render.
 * node tools/body-shape-visual.mjs --stage baseline --source reports/body-shape/baseline/bodyShape.ts
 * BODY_SHAPE_PYTHON=/path/to/python node tools/body-shape-visual.mjs --stage after
 * Python requires NumPy and Pillow. --audit-only skips images; --render-only reuses meshes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { build } from 'esbuild';
import {loadBodyPreview,bodyShapeCases} from './body-shape-visual-loader.mjs';
import * as THREE from 'three';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),value=(flag,fallback)=>args.includes(flag)?args[args.indexOf(flag)+1]:fallback;
const stage=value('--stage','current');
if(!/^[a-z0-9-]+$/i.test(stage))throw Error('Invalid stage');
const source=path.resolve(root,value('--source','src/render/bodyShape.ts'));
const out=path.join(root,'reports/body-shape',stage);fs.mkdirSync(out,{recursive:true});
if(!args.includes('--render-only')){
 const temporary=path.join(out,'.current-shape.mjs');
 await build({stdin:{contents:fs.readFileSync(source,'utf8'),loader:'ts',resolveDir:path.join(root,'src/render')},outfile:temporary,bundle:true,platform:'node',format:'esm',external:['three'],logLevel:'warning'});
 const shape=await import(pathToFileURL(temporary));fs.unlinkSync(temporary);
 const sourceSha=crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
 if(path.resolve(source)!==path.join(out,'bodyShape.ts'))fs.copyFileSync(source,path.join(out,'bodyShape.ts'));
 const manifest={stage,source:path.relative(root,source),sourceSha,generatedAt:new Date().toISOString(),cases:[]};
 const cases=bodyShapeCases(shape);
 for(const sex of ['male','female']){
  // Match the preview: deform local geometry; normalize initial height once.
  const {geometry,matrix,indices}=await loadBodyPreview(root,sex);
  const normMatrix=new THREE.Matrix3().getNormalMatrix(matrix);
  const prepared=shape.prepareDeformable(geometry),bounds=shape.shapeBounds([prepared]);
  fs.writeFileSync(path.join(out,`${sex}-indices.u32`),Buffer.from(indices.buffer));
  for(const spec of cases){
   const values=shape.normalizeShape(spec.values);shape.applyBodyShape([prepared],bounds,values);
   const positions=geometry.attributes.position.array,normals=geometry.attributes.normal.array,worldPositions=new Float32Array(positions.length),worldNormals=new Float32Array(normals.length),v=new THREE.Vector3();
   const box=new THREE.Box3();for(let i=0;i<positions.length;i+=3){v.fromArray(positions,i).applyMatrix4(matrix);v.toArray(worldPositions,i);box.expandByPoint(v);v.fromArray(normals,i).applyMatrix3(normMatrix).normalize().toArray(worldNormals,i);}
   const center=box.getCenter(new THREE.Vector3());for(let i=0;i<worldPositions.length;i+=3){worldPositions[i]-=center.x;worldPositions[i+1]-=center.y;worldPositions[i+2]-=center.z;}
   const id=`${sex}-${spec.id}`;fs.writeFileSync(path.join(out,`${id}-positions.f32`),Buffer.from(worldPositions.buffer));fs.writeFileSync(path.join(out,`${id}-normals.f32`),Buffer.from(worldNormals.buffer));
   manifest.cases.push({id,sex,case:spec.id,values,vertexCount:positions.length/3,faceCount:indices.length/3,dimensions:box.getSize(new THREE.Vector3()).toArray()});
  }
  console.log(`${sex}: decoded and reshaped ${cases.length} cases`);
 }
 fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2));
}
const result=spawnSync(process.env.BODY_SHAPE_PYTHON||'python3',[path.join(root,'tools/body-shape-visual.py'),out,...args.filter(a=>['--audit-only','--render-only','--all-renders'].includes(a))],{cwd:root,stdio:'inherit'});
process.exitCode=result.status||0;
