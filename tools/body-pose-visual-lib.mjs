/** Shared production-code fixtures for pose audits, renders and regression checks. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import * as THREE from 'three';
import draco3d from 'draco3d';
import {loadBodyPreview} from './body-shape-visual-loader.mjs';
export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
let decoderPromise;
async function addRealUVAndTangents(geometry,sex){
 const draco=await(decoderPromise??=draco3d.createDecoderModule({})),file=await fs.readFile(path.join(root,`public/models/body_${sex}_realistic.glb`));
 const length=file.readUInt32LE(12),gltf=JSON.parse(file.subarray(20,20+length).toString()),bin=file.subarray(28+length);
 const primitive=gltf.meshes.flatMap(m=>m.primitives).sort((a,b)=>gltf.accessors[b.attributes.POSITION].count-gltf.accessors[a.attributes.POSITION].count)[0];
 const ext=primitive.extensions.KHR_draco_mesh_compression,view=gltf.bufferViews[ext.bufferView],bytes=bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);
 const decoder=new draco.Decoder(),input=new draco.DecoderBuffer(),mesh=new draco.Mesh();input.Init(new Int8Array(bytes),bytes.length);
 const status=decoder.DecodeBufferToMesh(input,mesh);if(!status.ok())throw Error(status.error_msg());
 for(const [semantic,name,size]of [['TEXCOORD_0','uv',2],['TANGENT','tangent',4]]){
  const array=new draco.DracoFloat32Array();decoder.GetAttributeFloatForAllPoints(mesh,decoder.GetAttributeByUniqueId(mesh,ext.attributes[semantic]),array);
  geometry.setAttribute(name,new THREE.BufferAttribute(Float32Array.from({length:mesh.num_points()*size},(_,i)=>array.GetValue(i)),size));draco.destroy(array);
 }
 for(const item of [input,mesh,decoder])draco.destroy(item);
}
export async function loadPoseModules(){
 const temporary=path.join(os.tmpdir(),`smartink-pose-${process.pid}-${Date.now()}.mjs`);
 await build({stdin:{contents:"export * as pose from './src/render/bodyPose.ts';export * as shape from './src/render/bodyShape.ts';export * as surface from './src/render/surfacePlacement.ts';",resolveDir:root,loader:'ts'},outfile:temporary,bundle:true,platform:'node',format:'esm',logLevel:'silent'});
 const modules=await import(pathToFileURL(temporary));await fs.unlink(temporary);
 const sourceSha=crypto.createHash('sha256').update(await fs.readFile(path.join(root,'src/render/bodyPose.ts'))).update(await fs.readFile(path.join(root,'src/render/bodyShape.ts'))).digest('hex');
 return {...modules,sourceSha};
}
export function poseCases(modules){
 const {pose,shape}=modules;
 const keys=Object.keys(pose.BODY_POSE_BOUNDS),cases=[{id:'neutral',pose:{}}];
 for(const preset of pose.BODY_POSE_PRESETS)if(preset.id!=='neutral')cases.push({id:`preset-${preset.id}`,pose:preset.values,preset:true});
 for(const key of keys){const bounds=pose.BODY_POSE_BOUNDS[key];for(const end of ['min','max'])cases.push({id:`${key}-${end}`,pose:{[key]:bounds[end]},endpoint:true});}
 const allMax=Object.fromEntries(keys.map(k=>[k,pose.BODY_POSE_BOUNDS[k].max]));
 const allMin=Object.fromEntries(keys.map(k=>[k,pose.BODY_POSE_BOUNDS[k].min]));
 cases.push({id:'all-max',pose:allMax},{id:'all-min',pose:allMin});
 for(const sign of [-1,1])cases.push({id:`opposing-${sign<0?'a':'b'}`,pose:Object.fromEntries(keys.map((k,i)=>[k,pose.BODY_POSE_BOUNDS[k][(i%2===0)===(sign>0)?'max':'min']]))});
 const flex=pose.BODY_POSE_PRESETS.find(p=>p.id==='flex')?.values??{leftArmLift:35,rightArmLift:35,leftElbow:70,rightElbow:70};
 const step=pose.BODY_POSE_PRESETS.find(p=>p.id==='step')?.values??{leftLegForward:20,leftKnee:35,rightLegForward:-10};
 for(const sign of [-1,1])for(const [name,values]of [['flex',flex],['step',step],['all-max',allMax]])cases.push({id:`shape-${sign<0?'min':'max'}-${name}`,pose:values,shape:Object.fromEntries(shape.BODY_SHAPE_KEYS.map(k=>[k,sign]))});
 // Concrete regression discovered by the seeded audit: large chest + narrow
 // shoulders + lowered/bent arms compressed the inside of the right elbow.
 cases.push({id:'narrow-shoulder-bent-arms',pose:{leftArmLift:-10,rightArmLift:-10,leftArmForward:-10,rightArmForward:35,leftElbow:85,rightElbow:85,leftLegSpread:-5,rightLegSpread:15,leftLegForward:30,rightLegForward:30,leftKnee:55,rightKnee:0,headTurn:35,headTilt:-15},shape:{height:-.708207490388304,build:-.6008026460185647,shoulders:-.5522281057201326,chest:.9844621419906616,waist:.3190329517237842,belly:.7961039775982499,hips:-.554552327375859,arms:.2594106439501047,legs:-.025743006262928247,legLength:.5946361450478435,head:-.7985282926820219}});
 return cases;
}
export async function poseFixture(sex,modules){
 const {geometry:source,matrix}=await loadBodyPreview(root,sex);
 await addRealUVAndTangents(source,sex);
 const geometry=source.toNonIndexed();source.dispose();const indices=Uint32Array.from({length:geometry.attributes.position.count},(_,i)=>i);
 const prepared=modules.shape.prepareDeformable(geometry),bounds=modules.shape.shapeBounds([prepared]);
 const neutralWorld=geometry.clone().applyMatrix4(matrix);neutralWorld.computeBoundingBox();const center=neutralWorld.boundingBox.getCenter(new THREE.Vector3());neutralWorld.dispose();
 matrix.premultiply(new THREE.Matrix4().makeTranslation(-center.x,-center.y,-center.z));
 const topology=modules.surface.createSurfaceTopology(geometry),object=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());object.matrixAutoUpdate=false;object.matrix.copy(matrix);object.updateMatrixWorld(true);
 const uv=new Float32Array(geometry.attributes.position.count*2),mask=new Float32Array(geometry.attributes.position.count),anchors=[];
 for(const sign of [-1,1]){
  const ray=new THREE.Raycaster(new THREE.Vector3(sign*(sex==='male'?.81:.70),.40,3),new THREE.Vector3(0,0,-1));
  const hit=ray.intersectObject(object)[0];if(!hit)throw Error(`${sex}: diagnostic tattoo anchor missed`);
  const ids=[hit.face.a,hit.face.b,hit.face.c],local=geometry.attributes.position;
  const vertices=ids.map(i=>new THREE.Vector3().fromBufferAttribute(local,i).applyMatrix4(matrix));
  const bary=new THREE.Triangle(...vertices).getBarycoord(hit.point,new THREE.Vector3());
  const anchor={bodyMeshId:`body_${sex}`,faceIndex:hit.faceIndex,barycentric:bary.toArray()},chart=modules.surface.buildSurfaceChart(topology,geometry,matrix,anchor);
  if(!chart)throw Error(`${sex}: diagnostic tattoo chart rejected`);
  for(let face=0;face<indices.length/3;face++)if(chart.faceMask[face]>.999){
   for(let k=0;k<3;k++){const i=face*3+k;uv[i*2]=chart.uv[i*2];uv[i*2+1]=chart.uv[i*2+1];mask[i]=chart.mask[i];}
  }
  anchors.push(anchor);
 }
 geometry.setAttribute('aTattooUv',new THREE.BufferAttribute(uv,2));geometry.setAttribute('aTattooMask',new THREE.BufferAttribute(mask,1));
 return {geometry,matrix,indices,prepared,bounds,uv,mask,anchors};
}
export function applyPoseCase(fixture,modules,spec){
 modules.shape.applyBodyShape([fixture.prepared],fixture.bounds,modules.shape.normalizeShape(spec.shape));
 const shaped=fixture.geometry.attributes.position.array.slice();
 modules.pose.applyBodyPose([fixture.prepared],fixture.bounds,modules.pose.normalizePose(spec.pose));
 return shaped;
}
export function worldArrays(fixture){
 const positions=fixture.geometry.attributes.position.array,normals=fixture.geometry.attributes.normal.array;
 const output=new Float32Array(positions.length),normalOutput=new Float32Array(normals.length),normalMatrix=new THREE.Matrix3().getNormalMatrix(fixture.matrix),v=new THREE.Vector3(),box=new THREE.Box3();
 for(let i=0;i<positions.length;i+=3){v.fromArray(positions,i).applyMatrix4(fixture.matrix);v.toArray(output,i);box.expandByPoint(v);v.fromArray(normals,i).applyMatrix3(normalMatrix).normalize().toArray(normalOutput,i);}
 // Match the preview's object recentering after deformation.
 const center=box.getCenter(new THREE.Vector3());for(let i=0;i<output.length;i+=3){output[i]-=center.x;output[i+1]-=center.y;output[i+2]-=center.z;}
 return {positions:output,normals:normalOutput,dimensions:box.getSize(new THREE.Vector3()).toArray()};
}
