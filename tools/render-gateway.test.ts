import {createHandler, finalImage, validateInput} from '../supabase/functions/render-job/index.ts';
const uid='11111111-1111-4111-8111-111111111111', jobId='22222222-2222-4222-8222-222222222222';
const img='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAarVyFEAAAAASUVORK5CYII=';
const contract={schemaVersion:1,bodyMeshId:'body_full',inkTextureUrl:'ink.png',lookId:'studio_softbox',output:{width:512,height:512,qualityTier:'preview'}};
const config={url:'https://db.test',serviceKey:'server-only',runpodKey:'gpu-secret',endpoint:'endpoint',origins:['https://app.test']};
const assert=(x:unknown,message='Assertion failed')=>{if(!x)throw new Error(message);};
function setup(options: {anonymous?:boolean; active?:boolean; missing?:boolean; reserve?:boolean; limited?:boolean; status?:string; failedUpload?:boolean; direct?:boolean; wrongPath?:boolean; wrongSize?:boolean; signFailure?:boolean}={}) {
 const calls:{url:string;body:unknown;method:string}[]=[];
 const row={id:jobId,owner:uid,status:'IN_QUEUE',runpod_id:'provider-job',contract,result_path:null,expires_at:new Date(Date.now()+100000).toISOString()};
 const handler=createHandler(config,(async(input,init)=>{
  const url=String(input),method=init?.method??'GET';
  const body=typeof init?.body==='string'?JSON.parse(init.body):init?.body;
  calls.push({url,body,method});
  if(url.endsWith('/auth/v1/user')) return options.anonymous?Response.json({}, {status:401}):Response.json({id:uid,email_confirmed_at:'today'});
  if(url.includes('/rest/v1/waitlist'))return Response.json(options.active===false?[]:[{id:uid}]);
  if(url.endsWith('/rpc/reserve_render_job'))return options.limited?Response.json({message:'A render is already running. Wait or cancel it first.'},{status:400}):Response.json(options.reserve??true);
  if(url.includes('/rest/v1/render_jobs')){
   assert(url.includes(`owner=eq.${uid}`),'Every job query must include authenticated owner');
   if(method==='PATCH')Object.assign(row,body);return Response.json(options.missing?[]:[row]);
  }
  if(url.endsWith('/run'))return Response.json({id:'provider-job',status:'IN_QUEUE'});
  if(url.includes('/status/'))return Response.json({status:options.status??'IN_PROGRESS',output:options.direct?[{type:'final',path:options.wrongPath?'another-owner/image.png':`${uid}/${jobId}.png`,mimeType:'image/png',width:512,height:512,bytes:8*1024*1024}]:[{type:'final',image:img}]});
  if(url.includes('/stream/'))return Response.json({stream:[{output:{type:'progress',phase:'final',sample:3,total:16}},{output:{type:'preview',image:img}}]});
  if(url.includes('/cancel/'))return Response.json({status:'CANCELLED'});
  if(url.includes('/object/upload/sign/'))return options.signFailure?new Response(null,{status:500}):Response.json({url:`/object/upload/sign/renders/${uid}/${jobId}.png?token=upload-only`});
  if(method==='HEAD')return new Response(null,{status:options.failedUpload?404:200,headers:{'content-length':String(options.wrongSize?1:8*1024*1024),'content-type':'image/png'}});
  if(url.includes('/storage/'))return new Response(null,{status:options.failedUpload?500:200});
  if(url.includes('/render_history?'))return new Response(null,{status:201});
  throw new Error(`Unexpected fetch ${url}`);
 }) as typeof fetch);
 const request=(action:string,extra:Record<string,unknown>={},headers:Record<string,string>={})=>handler(new Request('https://gateway.test',{method:'POST',headers:{origin:'https://app.test',authorization:'Bearer a.b.c','content-type':'application/json',...headers},body:JSON.stringify({action,jobId,...extra})}));
 return {calls,request};
}
Deno.test('invalid session, missing bearer and disallowed origin never reach GPU',async()=>{
 for(const [opts,headers,status] of [[{anonymous:true},{},401],[{}, {authorization:''},401],[{}, {origin:'https://evil.test'},403]] as const){
  const s=setup(opts);assert((await s.request('submit',{},headers)).status===status);assert(!s.calls.some(c=>c.url.includes('runpod')));
 }
});
Deno.test('unapproved account denied',async()=>{const s=setup({active:false});assert((await s.request('status')).status===403);assert(!s.calls.some(c=>c.url.includes('runpod')));});
Deno.test('another user cannot read or cancel a job',async()=>{for(const action of ['status','cancel']){const s=setup({missing:true});assert((await s.request(action)).status===404);assert(!s.calls.some(c=>c.url.includes('runpod')));}});
Deno.test('reservation limits stop submission; repeat IDs never resubmit',async()=>{
 const limited=setup({limited:true});assert((await limited.request('submit',{contract,ink_base64:img})).status===429);assert(!limited.calls.some(c=>c.url.endsWith('/run')));
 const repeated=setup({reserve:false});assert((await repeated.request('submit',{contract,ink_base64:img})).status===200);assert(!repeated.calls.some(c=>c.url.endsWith('/run')));
});
Deno.test('submission is bounded and uses server-selected endpoint',async()=>{
 const s=setup();const res=await s.request('submit',{contract,ink_base64:img,endpoint:'attacker'});assert(res.status===200);
 const call=s.calls.find(c=>c.url.endsWith('/run'))!;assert(call.url==='https://api.runpod.ai/v2/endpoint/run');assert((call.body as {policy:{executionTimeout:number}}).policy.executionTimeout===660000);
 assert(!JSON.stringify(await res.json()).includes('secret'));
});
Deno.test('oversized or unsupported inputs rejected before reservation',async()=>{
 for(const bad of [{...contract,output:{...contract.output,width:4096}},{...contract,inkTextureUrl:'http://evil.test'},{...contract,bodyMeshId:'unknown'}]){
  const s=setup();assert((await s.request('submit',{contract:bad,ink_base64:img})).status===400);assert(!s.calls.some(c=>c.url.includes('reserve')));
 }
 validateInput({contract:{...contract,bodyMeshId:'body_full_female'},ink_base64:img});
});
Deno.test('progress and preview returned without provider ID',async()=>{const s=setup();const body=await(await s.request('status')).json();assert(body.progress.sample===3 && body.preview===img && !body.runpod_id);});
Deno.test('completed image stored privately and history written before completion',async()=>{
 const s=setup({status:'COMPLETED'});const body=await(await s.request('status')).json();assert(body.path===`${uid}/${jobId}.png`);
 const storage=s.calls.findIndex(c=>c.url.includes('/storage/'));const history=s.calls.findIndex(c=>c.url.includes('/render_history?'));const patch=s.calls.findIndex(c=>c.method==='PATCH');assert(storage<history && history<patch);
});
Deno.test('storage failure does not report success or mark job complete',async()=>{const s=setup({status:'COMPLETED',failedUpload:true});assert((await s.request('status')).status===503);assert(!s.calls.some(c=>c.method==='PATCH'));});
Deno.test('cancel only calls the owned provider job',async()=>{const s=setup();assert((await s.request('cancel',{runpod_id:'attacker'})).status===200);assert(s.calls.some(c=>c.url.endsWith('/cancel/provider-job')));});
Deno.test('split PNG reconstructs, duplicate or missing chunks rejected',()=>{
 const bytes=Uint8Array.from(atob(img),c=>c.charCodeAt(0));const chunks=[bytes.slice(0,31),bytes.slice(31)].map((c,index)=>({type:'image_chunk',index,total:2,image:btoa(String.fromCharCode(...c))}));
 const end={type:'final',chunkCount:2,bytes:bytes.length};assert(finalImage([...chunks,end]).every((v,i)=>v===bytes[i]));
 for(const bad of [[chunks[0],end],[chunks[0],chunks[0],end]]){let failed=false;try{finalImage(bad);}catch{failed=true;}assert(failed);}
});

Deno.test('signed upload is scoped to owner and never returned to browser',async()=>{
 const s=setup();const response=await s.request('submit',{contract,ink_base64:img,result_upload:{url:'https://evil.test'}});
 const payload=s.calls.find(c=>c.url.endsWith('/run'))!.body as {input:{result_upload:{url:string;path:string}}};
 assert(payload.input.result_upload.path===`${uid}/${jobId}.png`);
 assert(payload.input.result_upload.url===`https://db.test/storage/v1/object/upload/sign/renders/${uid}/${jobId}.png?token=upload-only`);
 assert(!JSON.stringify(payload).includes('server-only'));
 assert(!(await response.text()).includes('upload-only'));
});
Deno.test('signing failure releases reservation without starting GPU',async()=>{
 const s=setup({signFailure:true});assert((await s.request('submit',{contract,ink_base64:img})).status===503);
 assert(!s.calls.some(c=>c.url.endsWith('/run')));assert(s.calls.some(c=>c.method==='PATCH' && (c.body as {status:string}).status==='FAILED'));
});
Deno.test('large stored image uses metadata verification, no image proxy',async()=>{
 const s=setup({status:'COMPLETED',direct:true});const response=await s.request('status');assert(response.status===200);
 assert((await response.json()).path===`${uid}/${jobId}.png`);
 const storage=s.calls.filter(c=>c.url.includes('/storage/'));assert(storage.length===1 && storage[0].method==='HEAD');
 assert(s.calls.some(c=>c.url.includes('/render_history?')));
});
Deno.test('missing, mismatched or foreign stored image cannot complete job',async()=>{
 for(const option of [{wrongPath:true},{wrongSize:true},{failedUpload:true}]){
  const s=setup({status:'COMPLETED',direct:true,...option});assert((await s.request('status')).status>=400);
  assert(!s.calls.some(c=>c.method==='PATCH' || c.url.includes('/render_history?')));
  if(option.wrongPath)assert(!s.calls.some(c=>c.url.includes('/storage/')));
 }
});
Deno.test('Detailed 2560 dimensions accepted without rescaling',()=>{
 validateInput({contract:{...contract,output:{width:2560,height:1440,qualityTier:'final',samples:512}},ink_base64:img});
});
