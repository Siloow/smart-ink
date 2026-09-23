/** Shared real-GLB fixture loader for the visual audit and shape regression. */
import fs from 'node:fs';
import path from 'node:path';
import draco3d from 'draco3d';
import * as THREE from 'three';
let decoderPromise;
export async function loadBodyPreview(root,sex,meshRank=0){
 const draco=await(decoderPromise??=draco3d.createDecoderModule({}));
 const file=fs.readFileSync(path.join(root,`public/models/body_${sex}_realistic.glb`)),length=file.readUInt32LE(12),gltf=JSON.parse(file.subarray(20,20+length).toString()),bin=file.subarray(28+length);
 const best=gltf.meshes.flatMap((m,mesh)=>m.primitives.map(p=>({mesh,p,count:gltf.accessors[p.attributes.POSITION].count}))).sort((a,b)=>b.count-a.count)[meshRank];
 const ext=best.p.extensions.KHR_draco_mesh_compression,view=gltf.bufferViews[ext.bufferView],bytes=bin.subarray(view.byteOffset||0,(view.byteOffset||0)+view.byteLength);
 const decoder=new draco.Decoder(),input=new draco.DecoderBuffer(),decoded=new draco.Mesh();input.Init(new Int8Array(bytes),bytes.length);
 const status=decoder.DecodeBufferToMesh(input,decoded);if(!status.ok())throw Error(status.error_msg());
 const geometry=new THREE.BufferGeometry();
 for(const [semantic,name]of [['POSITION','position'],['NORMAL','normal']]){
  const array=new draco.DracoFloat32Array();decoder.GetAttributeFloatForAllPoints(decoded,decoder.GetAttributeByUniqueId(decoded,ext.attributes[semantic]),array);
  geometry.setAttribute(name,new THREE.BufferAttribute(Float32Array.from({length:decoded.num_points()*3},(_,i)=>array.GetValue(i)),3));draco.destroy(array);
 }
 const indices=new Uint32Array(decoded.num_faces()*3),face=new draco.DracoInt32Array();for(let i=0;i<decoded.num_faces();i++){decoder.GetFaceFromMesh(decoded,i,face);for(let k=0;k<3;k++)indices[i*3+k]=face.GetValue(k);}geometry.setIndex(new THREE.BufferAttribute(indices,1));
 for(const item of [face,input,decoded,decoder])draco.destroy(item);
 const nodes=gltf.nodes.map(n=>{const o=new THREE.Object3D();if(n.matrix){o.matrix.fromArray(n.matrix);o.matrix.decompose(o.position,o.quaternion,o.scale);}else{if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);}return o;});
 gltf.nodes.forEach((n,i)=>(n.children||[]).forEach(j=>nodes[i].add(nodes[j])));
 const node=nodes[gltf.nodes.findIndex(n=>n.mesh===best.mesh)];node.updateWorldMatrix(true,false);
 const world=geometry.clone().applyMatrix4(node.matrixWorld);world.computeBoundingBox();const factor=4.2/world.boundingBox.getSize(new THREE.Vector3()).y;world.dispose();
 const matrix=new THREE.Matrix4().makeScale(factor,factor,factor).multiply(node.matrixWorld);
 return {geometry,matrix,indices};
}
export function bodyShapeCases(shape){
 const cases=[{id:'default',values:{}},...shape.BODY_SHAPE_KEYS.flatMap(key=>[-1,1].map(v=>({id:`${key}-${v<0?'min':'max'}`,values:{[key]:v}}))),{id:'all-min',values:Object.fromEntries(shape.BODY_SHAPE_KEYS.map(k=>[k,-1]))},{id:'all-max',values:Object.fromEntries(shape.BODY_SHAPE_KEYS.map(k=>[k,1]))},...shape.BODY_SHAPE_PRESETS.filter(p=>p.id!=='default').map(p=>({id:`preset-${p.id}`,values:p.values}))];
 for(const sign of [-1,1]){
  cases.push({id:`build-${sign<0?'min':'max'}-local-opposite`,values:{build:sign,chest:-sign,waist:-sign,belly:-sign,arms:-sign,legs:-sign}});
  cases.push({id:`torso-${sign<0?'min':'max'}-limbs-opposite`,values:{shoulders:sign,chest:sign,waist:sign,belly:sign,hips:sign,arms:-sign,legs:-sign}});
  cases.push({id:`alternating-${sign<0?'a':'b'}`,values:Object.fromEntries(shape.BODY_SHAPE_KEYS.map((k,i)=>[k,i%2?sign:-sign]))});
 }
 return cases;
}
