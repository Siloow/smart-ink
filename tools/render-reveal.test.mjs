import assert from 'node:assert/strict';
import { build } from 'esbuild';
const { outputFiles } = await build({stdin:{contents:"export * from './src/services/cloudRenderService'; export * from './src/services/snapshotSession';",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'node',define:{'import.meta.env.DEV':'true','import.meta.env.VITE_RENDER_URL':'undefined'}});
const {renderContract,createSnapshotSession}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const contract={schemaVersion:1,bodyMeshId:'body_full',skinToneId:'tone_03',poseId:'neutral',lookId:'studio_softbox',inkTextureUrl:'ink.png',camera:{position:[0,0,8],target:[0,0,0],fov:45,aspect:1},output:{qualityTier:'final',width:640,height:640,samples:64}};
const image='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAarVyFEAAAAASUVORK5CYII=';
const ink=new Blob([Buffer.from(image,'base64')]);
function stream(events){const text=events.map(e=>JSON.stringify(e)).join('\n')+'\n';return new Response(new ReadableStream({start(c){const bytes=new TextEncoder().encode(text);for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}),{headers:{'Content-Type':'application/x-ndjson'}});}
const original=fetch,urls=[],progress=[];
try{
 globalThis.fetch=async (_url,options)=>{assert.equal(options.headers.Accept,'application/x-ndjson');return stream([{type:'progress',phase:'preparing'},{type:'preview',image},{type:'progress',phase:'final',sample:8,total:64},{type:'final',image}]);};
 const final=await renderContract(contract,ink,{onPreview:url=>urls.push(url),onProgress:p=>progress.push(p)});urls.push(final);assert.equal(urls.length,2);assert.equal(progress[1].sample,8);assert.notEqual(urls[0],final);
 for(const events of [[{type:'preview',image}], [{type:'error',message:'GPU stopped'}], [{type:'final',image:'broken'}]]){
  globalThis.fetch=async()=>stream(events);
  await assert.rejects(renderContract(contract,ink,{onPreview:url=>urls.push(url)}));
 }
 // Progressive request remains compatible with an old PNG-only server.
 globalThis.fetch=async()=>new Response(ink);
 urls.push(await renderContract(contract,ink,{onPreview:()=>assert.fail('unexpected preview')}));
}finally{globalThis.fetch=original;urls.forEach(URL.revokeObjectURL);}
// Preview URLs belong to their attempt, never history or a cancelled successor.
const revoked=[],history=[];let callbacks,finish;
const session=createSnapshotSession({render:(_c,_i,opts)=>{callbacks=opts;return new Promise(r=>finish=r);},revoke:u=>revoked.push(u),retain:async(_shot,url)=>history.push(url)});
session.open(async()=>({contract,inkBlob:ink}));const first=session.render();await new Promise(setImmediate);
callbacks.onPreview('preview:first');assert.equal(session.getState().previewUrl,'preview:first');assert.equal(session.getState().imageUrl,null);
const stale=callbacks;session.cancel();assert.equal(session.getState().previewUrl,null);stale.onPreview('preview:late');finish('final:late');await first;
assert.deepEqual(revoked,['preview:first','preview:late','final:late']);
const next=session.render();await new Promise(setImmediate);callbacks.onPreview('preview:second');finish('final:second');await next;
assert.deepEqual(history,['final:second']);assert.equal(session.getState().previewUrl,'preview:second');session.close();assert.ok(revoked.includes('preview:second'));assert.ok(revoked.includes('final:second'));
console.log('Render reveal: fragmented streaming, preview/final order, incomplete/error streams, legacy fallback, cancellation and preview URL ownership passed.');
