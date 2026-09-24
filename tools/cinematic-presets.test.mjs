import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { build } from 'esbuild';
const result=await build({stdin:{contents:"export * from './src/render/cinematicPresets'; export * from './src/render/tattooCamera'; export * from './src/render/snapshot'; export * from './src/render/buildContract';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {CINEMATIC_PRESETS,cinematicLights,frameTattoo,snapshotContract,validateContract}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
for(const preset of CINEMATIC_PRESETS) for(const normal of [[0,0,1],[0,0,-1],[1,0,0],[0,1,0]]) for(const aspect of [.45,1,2.1]){
 const frame={center:[.3,.7,.2],normal,up:normal[1]?[0,0,-1]:[0,1,0],radius:.3,minDistance:.18,points:new Float32Array([.1,.5,.2,.5,.9,.2])};
 const camera=frameTattoo(frame,preset.adjustment,aspect,preset.fov),lights=cinematicLights(preset,camera);
 assert.equal(camera.fov,preset.fov);assert.deepEqual(camera.target,frame.center);assert.ok(camera.position.every(Number.isFinite));
 assert.equal(lights.length,4);assert.ok(lights.every(l=>l.intensity>=0&&l.position.every(Number.isFinite)));
 for(const l of lights.filter(l=>l.type!=='ambient'))assert.deepEqual(l.target,frame.center,'lights follow any tattoo surface');
 const contract={schemaVersion:1,bodyMeshId:'body_full',skinToneId:'tone_03',poseId:'neutral',lookId:'studio_softbox',inkTextureUrl:'ink.png',camera:{...camera,aspect,aperture:preset.aperture,depthOfField:true},output:{qualityTier:'final',width:960,height:960,samples:64},lighting:{presetName:'studio',intensityScale:1.1,lights}};
 assert.deepEqual(validateContract(contract),[]);
 for(const quality of ['quick','detailed']){const shot=snapshotContract(contract,quality);assert.equal(shot.camera.aperture,preset.aperture);assert.equal(shot.camera.depthOfField,true);assert.deepEqual(shot.camera.position,camera.position);assert.equal(shot.camera.preserveFraming,true);}
}
const css=await fs.readFile('src/snapshot-mode.css','utf8');assert.ok(css.includes('.snapshot-preset:focus-visible'));assert.ok(css.includes('repeat(3,minmax(0,1fr))'));
console.log('Cinematic presets passed: front/back/limbs/poles, portrait/wide framing, camera-relative lighting and preserved lens settings in both qualities.');
