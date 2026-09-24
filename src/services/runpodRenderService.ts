import { getSupabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '../auth/supabaseClient';
import type { RenderContract } from '../render/contract';
import type { CloudRenderOptions, RenderProgress } from './cloudRenderService';

type Reply = { jobId?: string; status?: string; path?: string; error?: string; ready?: boolean; message?: string; progress?: RenderProgress; preview?: string };
async function call(body: Record<string, unknown>, signal?: AbortSignal): Promise<Reply> {
  const { data, error } = await getSupabase().auth.getSession();
  if (error || !data.session) throw new Error('Sign in to render.');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/render-job`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify(body),
  });
  const reply = await res.json() as Reply;
  if (!res.ok) throw new Error(reply.error || `Render request failed (${res.status}).`);
  return reply;
}
function pause(signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const cancel = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', cancel); resolve(); }, 2000);
    signal.addEventListener('abort', cancel, { once: true });
  });
}
export async function gatewayHealth() {
  const reply = await call({ action: 'health' }, AbortSignal.timeout(10000));
  return { online: true, ready: reply.ready === true, message: reply.message ?? 'Ready to render', cancellationSupported: true, timeoutSeconds: 1800 };
}
export async function renderOnRunpod(contract: RenderContract, ink: Blob, opts: CloudRenderOptions,
  signal: AbortSignal, validateImage: (res: Response) => Promise<Blob>): Promise<Blob> {
  if (ink.size > 6 * 1024 * 1024) throw new Error('Ink texture exceeds the 6 MiB beta limit.');
  const bytes = new Uint8Array(await ink.arrayBuffer());
  let raw = '';
  for (let i = 0; i < bytes.length; i += 32768) raw += String.fromCharCode(...bytes.subarray(i, i + 32768));
  signal.throwIfAborted();
  const jobId = crypto.randomUUID();
  let submitted = false;
  let completed = false;
  try {
    const scale = Math.min(1, 2048 / Math.max(contract.output.width, contract.output.height));
    const output = { ...contract.output, width: Math.round(contract.output.width * scale), height: Math.round(contract.output.height * scale) };
    opts.onStatusChange?.('uploading', scale < 1 ? 'Sending your scene… Beta renders use up to 2048 pixels.' : 'Sending your scene…');
    // Let submission finish on user abort, then cancel its known ID. Aborting /submit
    // in flight would hide whether a billable job was accepted.
    submitted = true;
    await call({ action: 'submit', jobId, contract: { ...contract, output, inkTextureUrl: 'ink.png' }, ink_base64: btoa(raw) }, AbortSignal.timeout(35000));
    while (true) {
      signal.throwIfAborted();
      const reply = await call({ action: 'status', jobId }, signal);
      if (reply.status === 'COMPLETED') {
        completed = true;
        if (!reply.path) throw new Error('The saved render is missing.');
        const { data: image, error } = await getSupabase().storage.from('renders').download(reply.path);
        if (error || !image) throw new Error('Your render is saved in history, but the download failed. Open render history to retry.');
        signal.throwIfAborted();
        return validateImage(new Response(image));
      }
      if (['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(reply.status ?? '')) {
        completed = true;
        throw new Error(reply.error ?? (reply.status === 'CANCELLED' ? 'Render cancelled.' : 'Render timed out. Please try again.'));
      }
      opts.onStatusChange?.('rendering', reply.status === 'IN_QUEUE' || reply.status === 'SUBMITTING'
        ? 'Waiting for a GPU… First renders can take a few minutes to start.' : 'Rendering your scene…');
      if (reply.progress && ['preparing', 'preview', 'final'].includes(reply.progress.phase)) opts.onProgress?.(reply.progress);
      if (reply.preview && opts.onPreview) {
        const preview = Uint8Array.from(atob(reply.preview), c => c.charCodeAt(0));
        const image = await validateImage(new Response(new Blob([preview], { type: 'image/png' })));
        signal.throwIfAborted();
        opts.onPreview(URL.createObjectURL(image));
      }
      await pause(signal);
    }
  } catch (error) {
    if (submitted && !completed) {
      try { await call({ action: 'cancel', jobId }, AbortSignal.timeout(25000)); }
      catch {
        if (signal.aborted) {
          const failure = new Error('Could not confirm cancellation. The job may finish in the background.');
          failure.name = 'CancellationUnconfirmedError';
          throw failure;
        }
      }
    }
    throw error;
  }
}
