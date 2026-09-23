import assert from 'node:assert/strict';
import { build } from 'esbuild';
const { outputFiles } = await build({ stdin: { contents: "export * from './src/services/snapshotSession'; export * from './src/render/snapshot';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false });
const {createSnapshotSession, snapshotOutput, snapshotContract} = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve,reject;const promise = new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}; };
const openAndRender = (session, prepare) => { session.open(prepare); void session.render(); };
const contract = {schemaVersion:1,bodyMeshId:'body_full',skinToneId:'tone_03',poseId:'neutral',lookId:'studio_softbox',inkTextureUrl:'ink.png',camera:{position:[3,.4,8.5],target:[0,0,0],fov:34,aspect:1.6},output:{qualityTier:'preview',width:512,height:512},studio:{mode:'sweep',color:'#657b91',shadow:.6},lighting:{presetName:'studio',lights:[]},bodyPose:{leftElbow:20},bodyAppearance:{top:'tshirt'}};
const shot = ()=>({contract:structuredClone(contract),inkBlob:new Blob(['ink']),sceneName:'Frozen scene'});
for (const aspect of [1/32,.3,.8,1,1.6,3,32,NaN,Infinity,0,-1]) for (const quality of ['quick','detailed']) {
 const out=snapshotOutput(aspect,quality);assert.equal(Math.max(out.width,out.height),quality==='quick'?960:2560);assert.equal(out.qualityTier,'final');assert.equal(out.samples,quality==='quick'?64:512);assert.ok(out.width>=30&&out.height>=30);
 if(Number.isFinite(aspect)&&aspect>0) assert.ok(Math.abs(out.width/out.height-aspect) < .025);
}
const converted=snapshotContract(contract,'detailed');assert.deepEqual(converted.camera.position,contract.camera.position);assert.equal(converted.camera.preserveFraming,true);assert.equal(converted.camera.aperture,8);assert.equal(converted.renderStyle,'cinematic');assert.equal(contract.camera.preserveFraming,undefined);converted.lighting.lights.push({});assert.equal(contract.lighting.lights.length,0);
// Duplicate clicks, frozen ink/scene, quality changes, previous image and history.
{
 let builds=0,calls=[],revoked=[],events=0;const pending=[],history=[];
 const original=shot();
 const session=createSnapshotSession({render:(c,ink,options)=>{calls.push({c,ink,options});const d=deferred();pending.push(d);return d.promise;},retain:()=>{const d=deferred();history.push(d);return d.promise;},revoke:url=>revoked.push(url),now:()=>123});
 const unsubscribe=session.subscribe(()=>events++);
 openAndRender(session, async()=>{builds++;return original;});openAndRender(session, async()=>{throw Error('duplicate open');});await tick();session.render();assert.equal(builds,1);assert.equal(calls.length,1);assert.equal(session.getState().startedAt,123);
 session.setQuality('detailed');assert.equal(session.getState().quality,'quick');
 calls[0].options.onStatusChange('rendering','Working');assert.equal(session.getState().message,'Working');
 pending[0].resolve('blob:first');await tick();assert.equal(session.getState().status,'done');assert.equal(history.length,1);
 original.contract.camera.position[0]=999;session.setQuality('detailed');const again=session.render();await tick();assert.equal(builds,1);assert.equal(calls.length,2);assert.equal(calls[1].c.camera.position[0],3);assert.equal(calls[1].c.output.width,2560);assert.equal(calls[1].ink,original.inkBlob);assert.equal(session.getState().imageUrl,'blob:first');
 pending[1].resolve('blob:second');await tick();assert.deepEqual(revoked,['blob:first']);history[0].reject(Error('old history failure'));await tick();assert.equal(session.getState().warning,'');history[1].reject(Error('history offline'));await again;assert.match(session.getState().warning,/ready to download/);assert.equal(session.getState().status,'done');
 session.close();assert.deepEqual(revoked,['blob:first','blob:second']);assert.equal(session.getState().open,false);const count=events;unsubscribe();session.setQuality('quick');assert.equal(events,count);
}
// Closing/cancelling during preparation doesn't post or resurrect a session.
for(const action of ['close','cancel']) {
 const prep=deferred();let signal,calls=0;
 const session=createSnapshotSession({render:async()=>{calls++;return 'blob:no';},revoke:()=>{}});
 openAndRender(session, async s=>{signal=s;return prep.promise;});session[action]();assert.equal(signal.aborted,true);prep.resolve(shot());await tick();assert.equal(calls,0);assert.equal(session.getState().status,action==='close'?'idle':'cancelled');
}
// A cancelled request may deliver late; it cannot replace a newer render or leak its URL.
{
 const pending=[],revoked=[];let builds=0;
 const session=createSnapshotSession({render:()=>{const d=deferred();pending.push(d);return d.promise;},revoke:url=>revoked.push(url)});
 openAndRender(session, async()=>{builds++;return shot();});await tick();session.cancel();const newer=session.render();await tick();pending[1].resolve('blob:new');await newer;pending[0].resolve('blob:late');await tick();assert.equal(session.getState().imageUrl,'blob:new');assert.deepEqual(revoked,['blob:late']);assert.equal(builds,1);session.close();
}
// Retry preparation failures, server failures and reopening with a new scene.
{
 let builds=0,requests=0;const revoked=[];
 const session=createSnapshotSession({render:async()=>{if(++requests===1)throw Error('Server unavailable');return 'blob:success';},revoke:url=>revoked.push(url)});
 openAndRender(session, async()=>{if(++builds===1)throw Error('Body loading');return shot();});await tick();assert.equal(session.getState().message,'Body loading');await session.render();assert.equal(session.getState().message,'Server unavailable');await session.render();assert.equal(builds,2);assert.equal(session.getState().status,'done');session.close();openAndRender(session, async()=>({...shot(),sceneName:'New scene'}));await tick();assert.equal(session.getState().status,'done');assert.deepEqual(revoked,['blob:success']);session.close();
}
console.log('Snapshot session passed: viewport crop, frozen inputs, quality, duplicates, cancellation, stale replies, retries, history failure, URL ownership.');

// Opening only composes; Render uses latest camera/light values, Adjust invalidates
// just the capture while keeping a prior PNG available until replacement.
{
 let prepared=0;const sent=[],revoked=[];let current=shot();
 const session=createSnapshotSession({render:async(c)=>{sent.push(c);return `blob:compose-${sent.length}`;},revoke:url=>revoked.push(url)});
 session.open(async()=>{prepared++;return current;});
 await tick();assert.equal(prepared,0);assert.equal(sent.length,0);assert.equal(session.getState().mode,'compose');assert.equal(session.getState().status,'idle');
 current.contract.camera.target=[.4,1,.2];current.contract.lighting.lights=[{type:'directional',position:[2,5,4],target:[.4,1,.2],intensity:.8,color:'#ffffff'}];
 await session.render();assert.equal(prepared,1);assert.equal(session.getState().mode,'result');assert.deepEqual(sent[0].camera.target,[.4,1,.2]);
 session.adjust();assert.equal(session.getState().mode,'compose');assert.equal(session.getState().imageUrl,'blob:compose-1');
 current=shot();current.contract.camera.target=[.6,.8,.2];current.contract.lighting.lights=[{type:'ambient',intensity:.12,color:'#ffccaa'}];
 session.setQuality('detailed');await session.render();assert.equal(prepared,2);assert.deepEqual(sent[1].camera.target,[.6,.8,.2]);assert.equal(sent[1].lighting.lights[0].color,'#ffccaa');assert.equal(sent[1].output.width,2560);assert.deepEqual(revoked,['blob:compose-1']);session.close();
}
console.log('Snapshot composition passed: no automatic request, edited camera/lights captured on Render, Adjust recaptures, previous image retained.');

// An old image cannot be compared to a newly composed camera/light setup.
{
 const pending=[];const session=createSnapshotSession({render:()=>{const d=deferred();pending.push(d);return d.promise;},revoke:()=>{}});
 session.open(async()=>shot());assert.equal(session.getState().imageMatchesView,false);
 let rendering=session.render();await tick();pending[0].resolve('blob:original');await rendering;assert.equal(session.getState().imageMatchesView,true);
 rendering=session.render();await tick();assert.equal(session.getState().imageMatchesView,true,'same-shot retry may compare');pending[1].reject(Error('offline'));await rendering;assert.equal(session.getState().imageMatchesView,true);
 session.adjust();assert.equal(session.getState().imageMatchesView,false);rendering=session.render();await tick();pending[2].reject(Error('offline'));await rendering;assert.equal(session.getState().imageMatchesView,false);assert.equal(session.getState().imageUrl,'blob:original');
 rendering=session.render();await tick();pending[3].resolve('blob:new');await rendering;assert.equal(session.getState().imageMatchesView,true);session.close();assert.equal(session.getState().imageMatchesView,false);
}
console.log('Comparison provenance passed: changed shots disable previous-image comparison until their own render succeeds.');
