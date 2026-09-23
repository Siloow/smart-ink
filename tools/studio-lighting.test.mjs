/** Real Three light objects, production skin uniforms, masked shadow programs and guide picking. */
import assert from 'node:assert/strict';import fs from 'node:fs/promises';import {build} from 'esbuild';import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const result=await build({stdin:{contents:"export * from './src/render/studioLightRig';export * from './src/render/studioLighting';export * from './src/config/lightingPresets';export * as THREE from 'three';",resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});const m=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`),T=m.THREE;
const modelSource=await fs.readFile(path.join(root,'src/ModelWithUVTattoo.tsx'),'utf8');
assert.match(modelSource,/gl_FragColor = skin;\s*#include <tonemapping_fragment>\s*#include <colorspace_fragment>/,'skin must share the standard-material photographic display transform before sRGB encoding');
for(const material of [new T.ShaderMaterial(),new T.MeshStandardMaterial()]){assert.equal(material.toneMapped,true,'skin and fabric default to renderer tone mapping');material.dispose();}
const make=(extra={})=>({type:'directional',position:[4,6,8],target:[0,1,0],intensity:.8,color:'#ffffff',castShadow:true,...extra});
const close=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-7,`${message}: ${a} vs ${b}`);
for(const type of ['directional','spot','point'])for(const softness of [0,.5,1]){
 const light=make({type,softness}),rig=m.resolveStudioLightRig([light],1.3);assert.equal(rig.samples.length,softness===0?1:4);close(rig.samples.reduce((s,l)=>s+l.intensity,0),1.04,'sample energy preserved');
 const mean=rig.samples.reduce((a,l)=>a.add(l.position),new T.Vector3()).multiplyScalar(1/rig.samples.length);close(mean.distanceTo(new T.Vector3(...light.position)),0,'emitter centered');
 const objects=m.createStudioLightObjects(rig);objects.updateMatrixWorld(true);const real=objects.children.filter(o=>o.isLight);assert.equal(real.length,rig.samples.length);
 for(let i=0;i<real.length;i++){const l=real[i],s=rig.samples[i];assert.equal(l.castShadow,true);close(l.intensity,s.intensity*Math.PI*(type==='directional'?1:s.distanceScale),'standard material energy matches skin');assert.equal(l.shadow.mapSize.width,type==='point'?256:1024);
  if(type!=='point'){assert.equal(l.target.parent,objects,'actual target attached as sibling');assert.deepEqual(l.target.getWorldPosition(new T.Vector3()).toArray(),light.target);assert.notEqual(l.target.parent,l);}
 }
 const uniforms=m.createSkinLightUniforms(rig);assert.equal(uniforms.uNumLights.value,rig.samples.length);assert.equal(uniforms.uLightPos.value.length,16);assert.equal(uniforms.uLightType.value[0],type==='spot'?2:type==='point'?1:0);for(let i=0;i<rig.samples.length;i++)assert.deepEqual(uniforms.uLightPos.value[i].toArray(),rig.samples[i].position.toArray());
 const performance=m.createStudioLightObjects(rig,true);assert.ok(performance.children.filter(o=>o.isLight).every(o=>!o.castShadow));
}
for(const type of ['directional','spot','point']){
 const sample=m.resolveStudioLightRig([make({type,position:[0,0,0],target:[0,0,0],softness:0})]).samples[0];
 if(type!=='point')assert.deepEqual(sample.target.toArray(),[0,-1,0],'coincident source/aim resolves to stable downward beam');
 for(const point of [new T.Vector3(),new T.Vector3(0,-1,0),new T.Vector3(1,0,0)])assert.ok(Number.isFinite(m.studioSampleAttenuation(sample,point)),'overhead zero-distance light remains finite');
 assert.ok(m.createSkinLightUniforms({samples:[sample],ambientColor:new T.Color(0,0,0),ambientStrength:0}).uLightDistanceScale.value.every(Number.isFinite));
}
{
 const point=m.resolveStudioLightRig([make({type:'point',position:[0,0,4],target:[0,0,0],softness:0})]).samples[0];close(m.studioSampleAttenuation(point,new T.Vector3()),1,'point normalized at aim');close(m.studioSampleAttenuation(point,new T.Vector3(0,0,-4)),.25,'inverse square');
 const spot=m.resolveStudioLightRig([make({type:'spot',position:[0,0,4],target:[0,0,0],angle:.4,penumbra:.5,softness:0})]).samples[0];close(m.studioSampleAttenuation(spot,new T.Vector3()),1,'spot center lit');close(m.studioSampleAttenuation(spot,new T.Vector3(4,0,0)),0,'outside cone dark');close(m.studioSampleAttenuation(spot,new T.Vector3(0,0,8)),0,'behind spot dark');
 const conePoint=new T.Vector3(Math.sin(.3)*4,0,4-Math.cos(.3)*4),value=m.studioSampleAttenuation(spot,conePoint);assert.ok(value>0&&value<1,'penumbra transitions smoothly');
 const hard=m.resolveStudioLightRig([make({type:'spot',position:[0,0,4],angle:.4,penumbra:0,softness:0})]).samples[0];assert.ok(Number.isFinite(m.studioSampleAttenuation(hard,new T.Vector3())),'hard cone cannot produce NaN');
}
{
 const rig=m.resolveStudioLightRig([make({enabled:false,intensity:100}),...Array.from({length:6},()=>make({softness:1})),make({type:'ambient',color:'#ff0000',intensity:.2}),make({type:'ambient',color:'#0000ff',intensity:.3})]);assert.equal(rig.samples.length,16,'maximum four enabled nonambient sources');close(rig.ambientStrength,.5,'ambient after source cap still included');close(rig.ambientColor.r,.4,'ambient color energy weighted');close(rig.ambientColor.b,.6,'ambient color energy weighted');
 for(const lights of [[],[make({enabled:false}),make({type:'ambient',enabled:false})]]){const empty=m.resolveStudioLightRig(lights);assert.equal(empty.samples.length,0);assert.equal(empty.ambientStrength,0);assert.equal(m.createStudioLightObjects(empty).children.length,0,'explicit all-off has no automatic rig');}
}
for(const [name,preset]of Object.entries(m.LIGHTING_PRESETS)){const rig=m.resolveRig(name);assert.ok(rig.every(l=>l.enabled&&l.name));assert.ok(rig.filter(l=>l.type!=='ambient').length<=4);rig[1].position[0]+=9;assert.notEqual(rig[1].position[0],preset.lights[1].position[0]);if(rig[1].blenderAreaSize){rig[1].blenderAreaSize[0]=99;assert.notEqual(preset.lights[1].blenderAreaSize[0],99,'shared preset emitter size immutable');}}
{
 const isolate={value:-1},materials=m.createBodyShadowMaterials(isolate);
 for(const [kind,material]of [['depth',materials.depth],['distanceRGBA',materials.distance]]){const base=T.ShaderLib[kind],shader={vertexShader:base.vertexShader,fragmentShader:base.fragmentShader,uniforms:{}};material.onBeforeCompile(shader,{});assert.equal(shader.uniforms.uIsolateRegion,isolate);assert.match(shader.vertexShader,/vBodyFocus = aFocusMask/);assert.match(shader.vertexShader,/vBodyClothing = aClothingMask/);assert.match(shader.fragmentShader,/vBodyFocus < 0\.0/);assert.match(shader.fragmentShader,/vBodyClothing >= 0\.0/);assert.match(shader.fragmentShader,/discard/);isolate.value=3;assert.equal(shader.uniforms.uIsolateRegion.value,3,'focus update reaches both shadow materials without recompiling');material.dispose();}
}
{
 const scene=new T.Scene(),group=new T.Group();group.userData.editorHelper=true;const card=new T.Mesh(new T.PlaneGeometry(1,1),new T.MeshBasicMaterial({side:T.DoubleSide}));group.add(card);scene.add(group);scene.updateMatrixWorld(true);const ray=new T.Raycaster(new T.Vector3(0,0,5),new T.Vector3(0,0,-1));assert.equal(m.rayHitsEditorHelper(ray,scene),true,'tagged parent intercepts guide click');
 const body=new T.Mesh(new T.BoxGeometry(1,1,1),new T.MeshBasicMaterial());body.position.z=1;scene.add(body);scene.updateMatrixWorld(true);assert.ok(m.nearestEditorHelperDistance(ray,scene)>ray.intersectObject(body)[0].distance,'occluded rear guide sorts after visible body');group.position.z=2;scene.updateMatrixWorld(true);assert.ok(m.nearestEditorHelperDistance(ray,scene)<ray.intersectObject(body)[0].distance,'front guide sorts before body');body.geometry.dispose();body.material.dispose();
 group.visible=false;assert.equal(m.rayHitsEditorHelper(ray,scene),false,'hidden capture guides never intercept');group.visible=true;card.visible=false;assert.equal(m.rayHitsEditorHelper(ray,scene),false,'hidden helper child skipped');card.visible=true;group.userData.editorHelper=false;assert.equal(m.rayHitsEditorHelper(ray,scene),false,'ordinary scene meshes are not editor guides');card.geometry.dispose();card.material.dispose();
}
console.log('Studio lighting passed: finite softbox energy/samples, real stable targets, spot cones/penumbra, inverse-square aiming, four-source cap, all-off state, skin/PBR uniforms, clipped depth/distance shadows, preset immutability and helper picking.');
