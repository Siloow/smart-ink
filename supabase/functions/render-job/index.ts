// All RunPod traffic stays here; no provider keys or arbitrary provider IDs from clients.
type Obj = Record<string, unknown>;
type Job = { id: string; owner: string; status: string; runpod_id: string | null; contract: Obj; result_path: string | null; expires_at: string };
type Config = { url: string; serviceKey: string; runpodKey: string; endpoint: string; origins: string[] };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY = 9 * 1024 * 1024;
const MAX_IMAGE = 5 * 1024 * 1024; // Compatibility with workers returning inline images.
const MAX_STORED_IMAGE = 50 * 1024 * 1024;
const terminal = new Set(['COMPLETED', 'FAILED', 'CANCELLED', 'TIMED_OUT']);
class Fault extends Error { constructor(public status: number, message: string) { super(message); } }
function object(value: unknown): Obj {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Fault(400, 'Expected a JSON object.');
  return value as Obj;
}
async function limitedJson(req: Request): Promise<Obj> {
  if (!req.headers.get('content-type')?.includes('application/json')) throw new Fault(415, 'Send JSON.');
  const reader = req.body?.getReader();
  if (!reader) throw new Fault(400, 'Missing request body.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read(); if (done) break;
      size += value.length; if (size > MAX_BODY) throw new Fault(413, 'Ink texture is too large.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return object(JSON.parse(new TextDecoder().decode(bytes))); }
  catch (error) { if (error instanceof Fault) throw error; throw new Fault(400, 'Invalid JSON.'); }
}
function base64(value: unknown, max: number): Uint8Array {
  if (typeof value !== 'string' || value.length > Math.ceil(max / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Fault(400, 'Invalid image data.');
  try { const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0)); if (bytes.length > max) throw new Error(); return bytes; }
  catch { throw new Fault(400, 'Invalid image data.'); }
}
export function png(bytes: Uint8Array): {width: number; height: number} {
  if (bytes.length < 45 || ![137,80,78,71,13,10,26,10].every((n,i)=>bytes[i]===n)
    || String.fromCharCode(...bytes.slice(12,16)) !== 'IHDR'
    || String.fromCharCode(...bytes.slice(-8,-4)) !== 'IEND') throw new Fault(400, 'Invalid PNG image.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16777216) throw new Fault(400, 'Invalid PNG dimensions.');
  return {width, height};
}
export function validateInput(body: Obj): Obj {
  const contract = object(body.contract); const output = object(contract.output);
  if (JSON.stringify(contract).length > 65536 || contract.schemaVersion !== 1
    || !['body_full','body_full_female'].includes(String(contract.bodyMeshId))
    || contract.inkTextureUrl !== 'ink.png') throw new Fault(400, 'Unsupported render contract.');
  if (!['preview','final'].includes(String(output.qualityTier))
    || !Number.isInteger(output.width) || !Number.isInteger(output.height)
    || Number(output.width)<64 || Number(output.height)<64
    || Number(output.width)>2560 || Number(output.height)>2560
    || (output.samples !== undefined && (!Number.isInteger(output.samples) || Number(output.samples)<1 || Number(output.samples)>512)))
    throw new Fault(400, 'Beta renders support up to 2560 pixels and 512 samples.');
  png(base64(body.ink_base64, 6 * 1024 * 1024));
  return contract;
}
export function finalImage(events: unknown): Uint8Array {
  if (!Array.isArray(events) || events.length>2000) throw new Fault(502, 'Render output is missing.');
  const items = events.map(object); const final = items.findLast(e => e.type === 'final');
  if (!final) throw new Fault(502, 'Final image is missing.');
  if (typeof final.image === 'string') { const bytes=base64(final.image,MAX_IMAGE); png(bytes); return bytes; }
  const count = Number(final.chunkCount);
  if (!Number.isInteger(count) || count<1 || count>16) throw new Fault(502, 'Invalid image chunks.');
  const chunks=items.filter(e=>e.type==='image_chunk').sort((a,b)=>Number(a.index)-Number(b.index));
  if (chunks.length!==count) throw new Fault(502, 'Incomplete image chunks.');
  const decoded=chunks.map((e,i)=>{
    if(e.index!==i || e.total!==count) throw new Fault(502,'Invalid image chunk order.');
    return base64(e.image,512*1024);
  });
  const length=decoded.reduce((n,c)=>n+c.length,0);
  if (length>MAX_IMAGE || length!==final.bytes) throw new Fault(502,'Invalid image size.');
  const bytes=new Uint8Array(length); let offset=0;
  for(const chunk of decoded){bytes.set(chunk,offset);offset+=chunk.length;} png(bytes); return bytes;
}
export function createHandler(config: Config, fetcher: typeof fetch = fetch) {
  return async (req: Request): Promise<Response> => {
    const origin=req.headers.get('origin');
    const cors: Record<string,string> = { 'Vary':'Origin', 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods':'POST, OPTIONS' };
    if(origin && config.origins.includes(origin)) cors['Access-Control-Allow-Origin']=origin;
    const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
    try {
      if(origin && !config.origins.includes(origin)) throw new Fault(403,'This website is not allowed.');
      if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
      if(req.method!=='POST') throw new Fault(405,'POST only.');
      const auth=req.headers.get('authorization') ?? '';
      if(!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth)) throw new Fault(401,'Sign in to render.');
      if(!config.url || !config.serviceKey) throw new Fault(503,'Render gateway is not configured.');
      const userRes=await fetcher(`${config.url}/auth/v1/user`,{headers:{apikey:config.serviceKey,Authorization:auth},signal:AbortSignal.timeout(10000)});
      if(!userRes.ok) throw new Fault(401,'Your session expired. Sign in again.');
      const user=object(await userRes.json());
      if(typeof user.id!=='string' || !UUID.test(user.id) || !user.email_confirmed_at) throw new Fault(403,'Confirm your email before rendering.');
      const adminHeaders={apikey:config.serviceKey,Authorization:`Bearer ${config.serviceKey}`};
      async function db(path:string, method='GET', body?:unknown): Promise<unknown> {
        const res=await fetcher(`${config.url}/rest/v1/${path}`,{method,headers:{...adminHeaders,'Content-Type':'application/json',Prefer:'return=representation'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
        if(!res.ok) {
          if(path==='rpc/reserve_render_job') {
            const detail=object(await res.json()); const msg=String(detail.message);
            if(msg.startsWith('A render is already') || msg.startsWith('Render limit')) throw new Fault(429,msg);
            if(msg.startsWith('Active beta')) throw new Fault(403,msg);
          }
          throw new Fault(503,'Could not update render job. Please retry.');
        }
        return res.status===204 ? null : res.json();
      }
      const access=await db(`waitlist?user_id=eq.${user.id}&status=eq.active&select=id&limit=1`) as unknown[];
      if(!access.length) throw new Fault(403,'Active beta access required.');
      const body=await limitedJson(req);
      if(!['health','submit','status','cancel'].includes(String(body.action))) throw new Fault(400,'Unknown render action.');
      const configured=Boolean(config.runpodKey && /^[a-z0-9]+$/.test(config.endpoint));
      if(body.action==='health') return json(200,{ready:configured,message:configured?'Ready to render':'RunPod connection is not configured.',cancellationSupported:true});
      if(!configured) throw new Fault(503,'RunPod connection is not configured.');
      if(typeof body.jobId!=='string' || !UUID.test(body.jobId)) throw new Fault(400,'Invalid job ID.');
      const id=body.jobId;
      const filter=`render_jobs?id=eq.${id}&owner=eq.${user.id}`;
      const loadJob=async()=>{
        const rows=await db(`${filter}&select=*`) as Job[];
        if(!rows[0]) throw new Fault(404,'Render job not found.'); return rows[0];
      };
      async function provider(path:string, method='GET', data?:unknown): Promise<Obj> {
        const res=await fetcher(`https://api.runpod.ai/v2/${config.endpoint}/${path}`,{method,headers:{Authorization:`Bearer ${config.runpodKey}`,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(20000)});
        if(!res.ok) throw new Fault(502,'The GPU service is temporarily unavailable. Please retry.');
        return object(await res.json());
      }
      if(body.action==='submit') {
        const contract=validateInput(body);
        const created=await db('rpc/reserve_render_job','POST',{p_owner:user.id,p_job:id,p_contract:contract});
        if(created) {
          // Never retry /run: an ambiguous network failure may already have created a billable job.
          // Its reservation stays locked until expiry; RunPod TTL and execution timeout bound cost.
          const path=`${user.id}/${id}.png`;
          // Only the gateway chooses the destination. The worker receives a temporary,
          // single-object upload capability, never the Supabase service key.
          let uploadUrl: string;
          try {
            const signed=await fetcher(`${config.url}/storage/v1/object/upload/sign/renders/${path}`,{
              method:'POST',headers:{...adminHeaders,'Content-Type':'application/json','x-upsert':'true'},
              body:'{}',signal:AbortSignal.timeout(10000),
            });
            if(!signed.ok) throw new Error();
            const data=object(await signed.json());
            if(typeof data.url!=='string') throw new Error();
            const url=new URL(`${config.url}/storage/v1${data.url}`);
            if(url.origin!==new URL(config.url).origin || url.pathname!==`/storage/v1/object/upload/sign/renders/${path}` || !url.searchParams.get('token')) throw new Error();
            uploadUrl=url.toString();
          } catch {
            await db(filter,'PATCH',{status:'FAILED'});
            throw new Fault(503,'Could not prepare image storage. Please start a new render.');
          }
          const submitted=await provider('run','POST',{input:{contract,ink_base64:body.ink_base64,result_upload:{url:uploadUrl,path}},policy:{executionTimeout:660000,ttl:900000}});
          if(typeof submitted.id!=='string' || !/^[a-zA-Z0-9_-]+$/.test(submitted.id)) throw new Fault(502,'Invalid GPU job response.');
          try { await db(filter,'PATCH',{runpod_id:submitted.id,status:'IN_QUEUE'}); }
          catch(error) { await provider(`cancel/${submitted.id}`,'POST').catch(()=>{}); throw error; }
        }
        const job=await loadJob(); return json(200,{jobId:id,status:job.status});
      }
      const job=await loadJob(); // Ownership is checked before any RunPod read or cancellation.
      if(body.action==='cancel') {
        if(!terminal.has(job.status)) {
          if(!job.runpod_id) throw new Fault(409,'Submission is still being confirmed. Retry cancellation shortly.');
          const cancelled=await provider(`cancel/${job.runpod_id}`,'POST');
          if(cancelled.status!=='CANCELLED') throw new Fault(409,'Cancellation is not confirmed. Check job status.');
          await db(filter,'PATCH',{status:'CANCELLED'});
          return json(200,{jobId:id,status:'CANCELLED'});
        }
        return json(200,{jobId:id,status:job.status});
      }
      if(job.result_path) return json(200,{jobId:id,status:'COMPLETED',path:job.result_path});
      if(terminal.has(job.status)) return json(200,{jobId:id,status:job.status});
      if(!job.runpod_id) return json(200,{jobId:id,status:Date.parse(job.expires_at)<Date.now()?'TIMED_OUT':'SUBMITTING'});
      const state=await provider(`status/${job.runpod_id}`);
      if(state.status==='COMPLETED') {
        const path=`${user.id}/${id}.png`;
        const output=object(job.contract.output);
        const final=Array.isArray(state.output)?state.output.map(object).findLast(e=>e.type==='final'):undefined;
        let width: number, height: number;
        if(final?.path!==undefined) {
          if(final.path!==path || final.mimeType!=='image/png'
            || final.width!==output.width || final.height!==output.height
            || !Number.isInteger(final.bytes) || Number(final.bytes)<45 || Number(final.bytes)>MAX_STORED_IMAGE)
            throw new Fault(502,'Invalid saved render.');
          // Verify the exact owned object exists without proxying the full PNG
          // through the edge function. Never fetch a URL supplied by the worker.
          const stored=await fetcher(`${config.url}/storage/v1/object/authenticated/renders/${path}`,{
            method:'HEAD',headers:adminHeaders,signal:AbortSignal.timeout(10000),
          });
          if(!stored.ok || Number(stored.headers.get('content-length'))!==final.bytes
            || stored.headers.get('content-type')?.split(';')[0]!=='image/png')
            throw new Fault(503,'The saved image is not available yet. Retry to finish saving.');
          width=Number(final.width); height=Number(final.height);
        } else {
          // Keep in-flight jobs from the previous image compatible during rollout.
          const bytes=finalImage(state.output); ({width,height}=png(bytes));
          const stored=await fetcher(`${config.url}/storage/v1/object/renders/${path}`,{method:'POST',headers:{...adminHeaders,'Content-Type':'image/png','x-upsert':'true'},body:new Uint8Array(bytes).buffer,signal:AbortSignal.timeout(20000)});
          if(!stored.ok) throw new Fault(503,'The image is ready but could not be saved. Retry to finish saving.');
        }
        // Ignore duplicate history IDs on concurrent/retried polls. Users may delete completed history.
        const recorded=await fetcher(`${config.url}/rest/v1/render_history?on_conflict=id`,{method:'POST',headers:{...adminHeaders,'Content-Type':'application/json',Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({id,owner:user.id,source:'cycles',width,height,quality_tier:output.qualityTier,look_id:job.contract.lookId,path}),signal:AbortSignal.timeout(10000)});
        if(!recorded.ok) throw new Fault(503,'Could not save render history. Retry to finish saving.');
        await db(filter,'PATCH',{status:'COMPLETED',result_path:path});
        return json(200,{jobId:id,status:'COMPLETED',path});
      }
      if(terminal.has(String(state.status))) {
        await db(filter,'PATCH',{status:state.status});
        return json(200,{jobId:id,status:state.status,error:state.status==='FAILED'?'The render could not finish. Please try again.':undefined});
      }
      if(!['IN_QUEUE','IN_PROGRESS'].includes(String(state.status))) throw new Fault(502,'Unknown GPU job state.');
      const stream=await provider(`stream/${job.runpod_id}`);
      const events=Array.isArray(stream.stream)?stream.stream.map(e=>object(object(e).output)):[];
      const progress=events.findLast(e=>e.type==='progress');
      const preview=events.findLast(e=>e.type==='preview' && typeof e.image==='string' && e.image.length<710000);
      return json(200,{jobId:id,status:state.status,progress,preview:preview?.image});
    } catch(error) {
      // Never relay raw upstream responses, credentials, or internal SQL errors.
      return json(error instanceof Fault?error.status:503,{error:error instanceof Fault?error.message:'Render service unavailable. Please retry.'});
    }
  };
}
if(import.meta.main) Deno.serve(createHandler({
  url:Deno.env.get('SUPABASE_URL') ?? '',
  serviceKey:Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  runpodKey:Deno.env.get('RUNPOD_API_KEY') ?? Deno.env.get('smart-ink') ?? '',
  endpoint:Deno.env.get('RUNPOD_ENDPOINT_ID') ?? 'diyhc9fflfp8rj',
  origins:(Deno.env.get('RENDER_ALLOWED_ORIGINS') ?? 'https://smart-ink-beta.pages.dev,http://127.0.0.1:5173,http://localhost:5173').split(',').map(s=>s.trim()),
}));
