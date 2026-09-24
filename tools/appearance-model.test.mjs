/** Actual Model callback integration without React/WebGL: callbacks are parsed
 * from ModelWithUVTattoo.tsx, transpiled, and run on the real GLB geometry.
 * Only hook scheduling and DOM pointer coordinates are supplied by this test. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
import {build,transformSync} from 'esbuild';
import * as THREE from 'three';
import {loadBodyPreview} from './body-shape-visual-loader.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const modelSource=await fs.readFile(path.join(root,'src/ModelWithUVTattoo.tsx'),'utf8');
const tree=ts.createSourceFile('ModelWithUVTattoo.tsx',modelSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
function findNode(predicate){const found=[];function visit(node){if(predicate(node))found.push(node);ts.forEachChild(node,visit);}visit(tree);assert.equal(found.length,1,'Production callback must be uniquely located');return found[0];}
function hook(name,marker){const node=findNode(n=>ts.isCallExpression(n)&&n.expression.getText(tree)===name&&n.arguments[0]&&ts.isArrowFunction(n.arguments[0])&&n.arguments[0].getText(tree).includes(marker));return node.arguments[0].getText(tree);}
function compile(expression,scope){const code=transformSync(`(${expression})`,{loader:'ts',target:'es2022'}).code;return new Function('scope',`with(scope){return ${code}}`)(scope);}
const callbackSources={shape:hook('useEffect','shapedPositionsRef.current = new Float32Array'),appearance:hook('useEffect','groups.push(createClothing('),focus:hook('useEffect',"mesh.geometry.getAttribute('aFocusMask')"),framing:hook('useCallback','const chunks = [visibleRegionPoints'),pick:hook('useCallback','pickBlockedRef.current = false')};
const recenterSource=findNode(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='recenterGroup').getText(tree);
const tmp=path.join(os.tmpdir(),`appearance-model-${process.pid}.mjs`);
const modules=['bodyShape','bodyPose','bodyRegions','bodyRegionMask','focusGeometry','focusCamera','bodyAppearance','previewHair','previewClothing','previewAppearance','studioLightRig'];
await build({stdin:{contents:modules.map((name,i)=>`export * as m${i} from './src/render/${name}.ts';`).join(''),resolveDir:root,loader:'ts'},outfile:tmp,bundle:true,platform:'node',format:'esm',logLevel:'silent'});const bundle=await import(pathToFileURL(tmp));await fs.unlink(tmp);const production=Object.assign({},...Object.values(bundle));
const ref=current=>({current});let rebuilds=0,disposals=0,blocked=0;
for(const sex of ['male','female']){
 const {geometry:source,matrix}=await loadBodyPreview(root,sex),geometry=source.toNonIndexed();source.dispose();const count=geometry.attributes.position.count;
 for(const name of ['aFocusMask','aClothingMask','aRegion'])geometry.setAttribute(name,new THREE.Float32BufferAttribute(new Float32Array(count).fill(name==='aFocusMask'?1:-1),1));
 const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));mesh.matrixAutoUpdate=false;mesh.matrix.copy(matrix);
 const cloneGroup=new THREE.Group();cloneGroup.add(mesh);const prepared=production.prepareDeformable(geometry),bounds=production.shapeBounds([prepared]);
 const frame=production.regionFrame(bounds),labels=geometry.attributes.aRegion.array;for(let i=0;i<count;i++)labels[i]=production.REGION_INDEX[production.classifyPoint(prepared.base[i*3],prepared.base[i*3+1],frame)];
 const scope={THREE,...production,bodyFit:null,fitAsset:null,eyesRef:ref(new THREE.Group()),scene:new THREE.Scene(),cloneGroup,bodyMeshRef:ref(mesh),deformablesRef:ref({items:[prepared],bounds}),shapedPositionsRef:ref(null),appearanceGroupsRef:ref([]),clothingCoverageRef:ref(null),hairCoverageRef:ref(null),regionMasksRef:ref(production.createRegionMasks(prepared.base,bounds)),isolateRegion:null,isolateRef:ref(null),bodyAppearance:production.DEFAULT_BODY_APPEARANCE,bodyShape:production.normalizeShape(),bodyPose:production.normalizePose(),pickTargetRef:ref(cloneGroup),pickBlockedRef:ref(false),mouse:ref(new THREE.Vector2()),raycaster:ref(new THREE.Raycaster()),camera:new THREE.PerspectiveCamera(45,1,.01,100),bodyDef:{id:`body_${sex}`},gl:{domElement:{getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})}}};
 scope.recenterGroup=compile(recenterSource,scope);const callbacks=Object.fromEntries(Object.entries(callbackSources).map(([name,code])=>[name,compile(code,scope)]));
 function appearance(choices={},region=null){scope.bodyAppearance=production.normalizeAppearance({...production.DEFAULT_BODY_APPEARANCE,...choices});scope.isolateRegion=scope.isolateRef.current=region;callbacks.focus();assert.equal(scope.eyesRef.current.visible,!region||region==='head');callbacks.appearance();rebuilds++;}
 function watchDisposal(){const groups=[...scope.appearanceGroupsRef.current],counts=[];for(const group of groups)group.traverse(o=>{if(!o.isMesh)return;for(const resource of[o.geometry,...(Array.isArray(o.material)?o.material:[o.material])]){const counter={n:0};resource.addEventListener('dispose',()=>{counter.n++;disposals++;});counts.push(counter);}});return()=>{for(const group of groups)assert.equal(group.parent,null,'Rebuild must detach prior accessory group');for(const counter of counts)assert.equal(counter.n,1,'Rebuild must dispose prior resource exactly once');};}
 function aim(point,direction=new THREE.Vector3(0,0,1)){scope.camera.position.copy(point).addScaledVector(direction,4);scope.camera.lookAt(point);scope.camera.updateMatrixWorld(true);cloneGroup.updateMatrixWorld(true);}
 function pick(){return callbacks.pick({clientX:50,clientY:50});}
 function worldPoint(index){return new THREE.Vector3().fromBufferAttribute(geometry.attributes.position,index).applyMatrix4(mesh.matrixWorld);}
 function cameraEnclosesAccessories(region){const framing=callbacks.framing(region);assert.ok(framing);const cameraState=production.fitRegionCamera(framing,[0,0,1],45,.5),camera=new THREE.PerspectiveCamera(45,.5,.01,100);camera.position.fromArray(cameraState.position);camera.lookAt(...cameraState.target);camera.updateMatrixWorld(true);let points=0;for(const group of scope.appearanceGroupsRef.current)group.traverse(child=>{if(!child.isMesh)return;for(let i=0;i<child.geometry.attributes.position.count;i+=17){const v=new THREE.Vector3().fromBufferAttribute(child.geometry.attributes.position,i).applyMatrix4(child.matrixWorld).project(camera);assert.ok(Math.abs(v.x)<=1&&Math.abs(v.y)<=1,'Hair/outfit outside frame');points++;}});assert.ok(points>0);}
 callbacks.shape();appearance();const torsoPoint=new THREE.Vector3(0,.65,.15);aim(torsoPoint);const originalHit=pick();assert.ok(originalHit?.anchor,'Unclothed real body must pick');const anchor=structuredClone(originalHit.anchor);
 const styles=[{top:'tshirt',bottom:'shorts',hairStyle:'short'},{top:'tshirt',bottom:'trousers',hairStyle:'buzz',hairTone:'blond'},{hairStyle:'short',hairTone:'grey'},{}, {top:'tshirt',bottom:'trousers',hairStyle:'short'}];
 for(const spec of [{shape:{},pose:{}},{shape:{height:1,head:1,chest:1},pose:{headTurn:35,headTilt:15,leftElbow:70,rightElbow:70}}]){
  scope.bodyShape=production.normalizeShape(spec.shape);scope.bodyPose=production.normalizePose(spec.pose);callbacks.shape();cloneGroup.updateMatrixWorld(true);const positions=geometry.attributes.position.array.slice(),origin=cloneGroup.position.clone(),worldMatrix=mesh.matrixWorld.clone(),anchorPoints=[0,1,2].map(k=>worldPoint(anchor.faceIndex*3+k));
  for(const style of styles){const disposed=watchDisposal();appearance(style);disposed();assert.deepEqual(geometry.attributes.position.array,positions,'Appearance changed body positions');assert.ok(cloneGroup.position.equals(origin),'Appearance changed body origin');assert.ok(mesh.matrixWorld.equals(worldMatrix),'Appearance changed body transform');for(let k=0;k<3;k++)assert.ok(worldPoint(anchor.faceIndex*3+k).equals(anchorPoints[k]),'Saved face anchor moved');}
  cameraEnclosesAccessories(null);
  for(const region of ['torso','armLeft','head']){const disposed=watchDisposal();appearance(styles.at(-1),region);disposed();assert.ok(geometry.attributes.aClothingMask.array.every(v=>v===-1),'Focus must expose covered skin');assert.ok(scope.appearanceGroupsRef.current.every(g=>g.userData.previewAppearance==='hair'),'Focus retained clothing');assert.equal(scope.appearanceGroupsRef.current.length,region==='head'?1:0);if(region==='head')cameraEnclosesAccessories(region);}
  appearance(styles.at(-1));assert.ok(geometry.attributes.aClothingMask.array.some(v=>v>0),'Leaving Focus must restore garment mask');
 }
 // Real triangle ray hits through the actual Model callback: accessory indices
 // can never become a body tattoo anchor, even when hidden groups remain.
 scope.bodyShape=production.normalizeShape();scope.bodyPose=production.normalizePose();callbacks.shape();appearance(styles[0]);aim(torsoPoint);assert.equal(pick(),null,'Visible shirt must block placement');assert.equal(scope.pickBlockedRef.current,true);blocked++;
 appearance(styles[0],'torso');aim(torsoPoint);const focusedHit=pick();assert.ok(focusedHit?.anchor);assert.equal(focusedHit.anchor.bodyMeshId,anchor.bodyMeshId);assert.equal(focusedHit.anchor.faceIndex,anchor.faceIndex);assert.ok(focusedHit.anchor.barycentric.every((v,i)=>Math.abs(v-anchor.barycentric[i])<1e-6),'Focus/rebuild changed anchor barycentrics');
 appearance({hairStyle:'short'},'head');let scalpIndex=0;for(let i=1;i<count;i++)if(geometry.attributes.position.getY(i)>geometry.attributes.position.getY(scalpIndex))scalpIndex=i;aim(worldPoint(scalpIndex),new THREE.Vector3(0,1,.2).normalize());assert.equal(pick(),null,'Hair must block scalp placement');assert.equal(scope.pickBlockedRef.current,true);blocked++;
 appearance({},'head');aim(worldPoint(scalpIndex),new THREE.Vector3(0,1,.2).normalize());assert.ok(pick()?.anchor,'Removing hair must restore scalp placement');
 appearance();aim(torsoPoint);scope.scene.add(cloneGroup);
 const lightGuide=new THREE.Mesh(new THREE.PlaneGeometry(.3,.3),new THREE.MeshBasicMaterial({side:THREE.DoubleSide}));lightGuide.userData.editorHelper=true;scope.scene.add(lightGuide);
 lightGuide.position.copy(torsoPoint).add(new THREE.Vector3(0,0,-1));scope.scene.updateMatrixWorld(true);assert.ok(pick()?.anchor,'A guide behind visible skin must not block tattoo placement');
 lightGuide.position.copy(torsoPoint).add(new THREE.Vector3(0,0,1));scope.scene.updateMatrixWorld(true);assert.equal(pick(),null,'A foreground guide owns the click');
 lightGuide.visible=false;assert.ok(pick()?.anchor,'Hidden guide must not block placement');scope.scene.remove(lightGuide);lightGuide.geometry.dispose();lightGuide.material.dispose();
 appearance();aim(torsoPoint);const proxyGroup=new THREE.Group();proxyGroup.userData.previewAppearance='hair';const proxy=new THREE.Mesh(new THREE.SphereGeometry(.2,8,6),new THREE.MeshBasicMaterial());proxy.position.copy(torsoPoint).add(new THREE.Vector3(0,0,.8));proxyGroup.add(proxy);cloneGroup.parent?.remove(cloneGroup);const scene=new THREE.Group();scene.add(cloneGroup,proxyGroup);scope.pickTargetRef.current=scene;scene.updateMatrixWorld(true);assert.equal(pick(),null,'Ancestor-tagged accessory face leaked into anchor');blocked++;proxyGroup.visible=false;assert.ok(pick()?.anchor,'Invisible accessory must not block');scene.remove(proxyGroup);proxy.geometry.dispose();proxy.material.dispose();
 scope.appearanceGroupsRef.current.forEach(production.disposeAppearance);geometry.dispose();mesh.material.dispose();console.log(`${sex}: production Model effects/picks passed appearance rebuilds, disposal, Focus skin restore, hair framing and protected body anchors.`);
}
console.log(`Appearance Model integration passed: ${rebuilds} actual effect rebuilds, ${disposals} disposal events, ${blocked} accessory blocking scenarios.`);
