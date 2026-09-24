// Exercises the production frontend adapter with mocked auth/storage and gateway.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAarVyFEAAAAASUVORK5CYII=', 'base64')], {type:'image/png'});
let session = { access_token:'test-user-jwt' }, downloads = [];
globalThis.__gatewayTestClient = { auth:{getSession:async()=>({data:{session}})}, storage:{from(bucket){assert.equal(bucket,'renders');return {download:async path=>{downloads.push(path);return {data:png}}}}} };
const built = await build({entryPoints:['src/services/cloudRenderService.ts'],bundle:true,write:false,format:'esm',platform:'node',define:{'import.meta.env':JSON.stringify({DEV:false,VITE_RENDER_BACKEND:'runpod'})},plugins:[{name:'mock-auth',setup(build){build.onResolve({filter:/auth\/supabaseClient$/},()=>({path:'auth',namespace:'test'}));build.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const getSupabase=()=>globalThis.__gatewayTestClient; export const SUPABASE_URL="https://project.test"; export const SUPABASE_ANON_KEY="public-key";'}));}}]});
const service = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const contract={schemaVersion:1,bodyMeshId:'body_full',skinToneId:'tone_03',poseId:'neutral',lookId:'studio_softbox',inkTextureUrl:'ink.png',camera:{position:[0,0,8],target:[0,0,0],fov:45,aspect:1},output:{qualityTier:'preview',width:512,height:512}};
const originalFetch=globalThis.fetch, originalBitmap=globalThis.createImageBitmap;
globalThis.createImageBitmap=async()=>({close(){}});
let calls=[];
function gateway(handler){calls=[];globalThis.fetch=async(url,options)=>{assert.equal(url,'https://project.test/functions/v1/render-job');assert.equal(options.headers.Authorization,'Bearer test-user-jwt');assert.equal(options.headers.apikey,'public-key');const body=JSON.parse(options.body);calls.push(body);return handler(body,options);};}
try {
 assert.equal(service.usesRunpodGateway(),true);
 gateway(body=>Response.json(body.action==='submit'?{status:'IN_QUEUE'}:{status:'COMPLETED',path:'owner/result.png'}));
 const result=await service.renderContract(contract,png);URL.revokeObjectURL(result);
 assert.deepEqual(calls.map(c=>c.action),['submit','status']);assert.equal(calls[0].jobId,calls[1].jobId);assert.deepEqual(downloads,['owner/result.png']);assert.equal(calls[0].contract.inkTextureUrl,'ink.png');
 gateway(body=>Response.json(body.action==='submit'?{status:'IN_QUEUE'}:{status:'COMPLETED',path:'owner/large.png'}));
 const large=await service.renderContract({...contract,output:{...contract.output,width:2560,height:1280}},png);URL.revokeObjectURL(large);assert.equal(calls[0].contract.output.width,2048);assert.equal(calls[0].contract.output.height,1024);
 session=null;calls=[];await assert.rejects(service.renderContract(contract,png),/Sign in/);assert.equal(calls.length,0);session={access_token:'test-user-jwt'};
 for(const failCancel of [false,true]){
  const controller=new AbortController();
  gateway(body=>{if(body.action==='submit'){controller.abort();return Response.json({status:'IN_QUEUE'});}assert.equal(body.action,'cancel');return failCancel?Response.json({error:'Cancellation is not confirmed.'},{status:409}):Response.json({status:'CANCELLED'});});
  await assert.rejects(service.renderContract(contract,png,{signal:controller.signal}),error=>error.name===(failCancel?'CancellationUnconfirmedError':'AbortError'));
  assert.deepEqual(calls.map(c=>c.action),['submit','cancel']);assert.equal(calls[0].jobId,calls[1].jobId);
 }
 gateway(body=>Response.json(body.action==='submit'?{status:'IN_QUEUE'}:body.action==='status'?{error:'GPU unavailable'}:{status:'CANCELLED'},{status:body.action==='status'?502:200}));
 await assert.rejects(service.renderContract(contract,png),/GPU unavailable/);assert.deepEqual(calls.map(c=>c.action),['submit','status','cancel']);
 console.log('RunPod frontend tests passed: private download, login, confirmed/unconfirmed cancellation, failure cleanup.');
} finally {globalThis.fetch=originalFetch;globalThis.createImageBitmap=originalBitmap;delete globalThis.__gatewayTestClient;}
