import { validateContract } from '../render/buildContract';
import type { RenderContract } from '../render/contract';

const CLOUD_RENDER_URL =
  'https://smart-ink-render-615593848551.europe-west4.run.app';

/** In dev, default to same-origin (Vite proxies /health and /render-v2 → :8000). */
const RENDER_URL =
  import.meta.env.VITE_RENDER_URL ??
  (import.meta.env.DEV ? '' : CLOUD_RENDER_URL);

export function usesRunpodGateway(): boolean {
  return import.meta.env?.VITE_RENDER_BACKEND === 'runpod';
}

export function getRenderUrl(): string {
  return RENDER_URL;
}

export function getRenderTargetLabel(): 'local' | 'cloud' {
  if (usesRunpodGateway()) return 'cloud';
  if (import.meta.env.DEV && !import.meta.env.VITE_RENDER_URL) return 'local';
  const url = RENDER_URL.toLowerCase();
  if (url.includes('localhost') || url.includes('127.0.0.1')) return 'local';
  return 'cloud';
}

export type RenderStatus = 'idle' | 'uploading' | 'rendering' | 'done' | 'error' | 'cancelled';

export interface RenderProgress {
  phase: 'preparing' | 'preview' | 'final';
  sample?: number;
  total?: number;
}

export interface CloudRenderOptions {
  onProgress?: (progress: RenderProgress) => void;
  /** Receiver owns and must revoke this temporary URL. */
  onPreview?: (url: string) => void;
  onStatusChange?: (status: RenderStatus, message?: string) => void;
  signal?: AbortSignal;
  /** Includes uploading, rendering, and receiving the image. Default: 10 minutes + server cleanup. */
  timeoutMs?: number;
}

export interface RenderServerStatus {
  online: boolean;
  ready: boolean;
  message: string;
  activeRenders?: number;
  timeoutSeconds?: number;
  cancellationSupported?: boolean;
}

function requestLifetime(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(new DOMException('Render cancelled', 'AbortError'));
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    if (controller.signal.aborted) return;
    timedOut = true;
    controller.abort(new DOMException('The render server took too long. Please try again.', 'TimeoutError'));
  }, Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, 1_830_000)) : 630_000);
  return {
    signal: controller.signal,
    error(error: unknown): Error {
      if (error instanceof Error && error.name === 'CancellationUnconfirmedError') return error;
      if (controller.signal.aborted) {
        return new DOMException(
          timedOut ? 'The render server took too long. Please try again.' : 'Render cancelled',
          timedOut ? 'TimeoutError' : 'AbortError'
        );
      }
      return error instanceof Error ? error : new Error(String(error));
    },
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
    },
  };
}

function shotForm(contract: RenderContract, inkLayer: Blob): FormData {
  const errs = validateContract(contract);
  if (errs.length) throw new Error('Invalid contract: ' + errs.join('; '));
  const form = new FormData();
  form.append('contract', new Blob([JSON.stringify(contract)], { type: 'application/json' }), 'contract.json');
  form.append('ink_layer', inkLayer, 'ink.png');
  return form;
}

async function responseError(res: Response, fallback: string): Promise<Error> {
  let message = `${fallback} (${res.status})`;
  const body = await res.text();
  try {
    const parsed = JSON.parse(body) as { detail?: string | Array<{ msg?: string }>; error?: string };
    if (typeof parsed.detail === 'string') message = parsed.detail;
    else if (Array.isArray(parsed.detail)) message = parsed.detail.map((item) => item.msg ?? String(item)).join('; ');
    else if (typeof parsed.error === 'string') message = parsed.error;
  } catch {
    if (body && !body.trimStart().startsWith('<')) message = body.slice(0, 500);
  }
  return new Error(message);
}

async function readRenderImage(res: Response): Promise<Blob> {
  const blob = await res.blob();
  if (!blob.size || blob.size > 128 * 1024 * 1024) throw new Error('The render server returned an empty or oversized image.');
  // Do not trust a successful HTTP status or a filename. Proxies can return HTML
  // error pages with status 200. Decode in browsers before retaining a URL.
  const bytes = new Uint8Array(await blob.slice(0, 33).arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 33 || !signature.every((value, i) => bytes[i] === value) ||
      String.fromCharCode(...bytes.slice(12, 16)) !== 'IHDR') {
    throw new Error('The render server did not return a PNG image.');
  }
  const view = new DataView(bytes.buffer);
  const width = view.getUint32(16), height = view.getUint32(20);
  if (!width || !height || width > 8192 || height > 8192 || width * height > 16_777_216) {
    throw new Error('The render server returned invalid image dimensions.');
  }
  const tail = new Uint8Array(await blob.slice(-12).arrayBuffer());
  if (String.fromCharCode(...tail.slice(4, 8)) !== 'IEND') throw new Error('The rendered image is incomplete.');
  if (typeof createImageBitmap === 'function') {
    try {
      const image = await createImageBitmap(blob);
      image.close();
    } catch {
      throw new Error('The rendered image could not be decoded.');
    }
  }
  return blob.type === 'image/png' ? blob : new Blob([blob], { type: 'image/png' });
}

async function readProgressiveRender(res: Response, opts: CloudRenderOptions, signal: AbortSignal): Promise<Blob> {
  if (!res.body) throw new Error('The render stream is unavailable.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      if (pending.length > 180 * 1024 * 1024) throw new Error('The render response is too large.');
      let boundary: number;
      while ((boundary = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, boundary).trim();
        pending = pending.slice(boundary + 1);
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.type === 'error') throw new Error(typeof event.message === 'string' ? event.message : 'Render failed.');
        if (event.type === 'progress' && ['preparing', 'preview', 'final'].includes(event.phase)) {
          const valid = Number.isInteger(event.sample) && Number.isInteger(event.total) && event.total > 0 && event.sample >= 0 && event.sample <= event.total;
          opts.onProgress?.({ phase: event.phase, ...(valid ? { sample: event.sample, total: event.total } : {}) });
          opts.onStatusChange?.('rendering', event.phase === 'preparing' ? 'Preparing scene…' : event.phase === 'preview' ? 'Developing your preview…' : valid && event.sample === event.total ? 'Finishing details…' : 'Refining details…');
        }
        if (event.type === 'preview' || event.type === 'final') {
          if (typeof event.image !== 'string') throw new Error('The render image is missing.');
          const bytes = Uint8Array.from(atob(event.image), c => c.charCodeAt(0));
          const blob = await readRenderImage(new Response(new Blob([bytes], { type: 'image/png' })));
          signal.throwIfAborted();
          if (event.type === 'final') return blob;
          if (opts.onPreview) opts.onPreview(URL.createObjectURL(blob));
        }
      }
      if (done) throw new Error('The render connection ended before the final image arrived.');
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function renderContract(
  contract: RenderContract,
  inkLayer: Blob,
  opts?: CloudRenderOptions
): Promise<string> {
  const lifetime = requestLifetime(opts?.signal, opts?.timeoutMs ?? (usesRunpodGateway() ? 1_800_000 : 630_000));
  try {
    lifetime.signal.throwIfAborted();
    const form = shotForm(contract, inkLayer);
    if (usesRunpodGateway()) {
      const { renderOnRunpod } = await import('./runpodRenderService');
      const blob = await renderOnRunpod(contract, inkLayer, opts ?? {}, lifetime.signal, readRenderImage);
      lifetime.signal.throwIfAborted();
      opts?.onStatusChange?.('done', 'Render saved to history.');
      return URL.createObjectURL(blob);
    }
    opts?.onStatusChange?.('uploading', 'Sending shot to render server...');
    opts?.onStatusChange?.('rendering', 'Rendering with Cycles...');
    const res = await fetch(`${RENDER_URL}/render-v2`, { method: 'POST', body: form, signal: lifetime.signal, ...(opts?.onPreview ? { headers: { Accept: 'application/x-ndjson' } } : {}) });
    if (!res.ok) throw await responseError(res, 'Render failed');
    const blob = res.headers.get('content-type')?.includes('application/x-ndjson')
      ? await readProgressiveRender(res, opts ?? {}, lifetime.signal) : await readRenderImage(res);
    lifetime.signal.throwIfAborted();
    opts?.onStatusChange?.('done', 'Render complete!');
    return URL.createObjectURL(blob);
  } catch (error) {
    const failure = lifetime.error(error);
    opts?.onStatusChange?.(failure.name === 'AbortError' ? 'cancelled' : 'error', failure.message);
    throw failure;
  } finally {
    lifetime.dispose();
  }
}

export async function syncToLiveWatcher(
  contract: RenderContract,
  inkLayer: Blob,
  opts?: Pick<CloudRenderOptions, 'signal' | 'timeoutMs'>
): Promise<void> {
  const lifetime = requestLifetime(opts?.signal, opts?.timeoutMs ?? 30_000);
  try {
    lifetime.signal.throwIfAborted();
    const res = await fetch(`${RENDER_URL}/sync-live`, { method: 'POST', body: shotForm(contract, inkLayer), signal: lifetime.signal });
    if (!res.ok) throw await responseError(res, 'Sync to Blender failed');
  } catch (error) {
    throw lifetime.error(error);
  } finally {
    lifetime.dispose();
  }
}

export async function getRenderServerStatus(): Promise<RenderServerStatus> {
  if (usesRunpodGateway()) {
    try { return await (await import('./runpodRenderService')).gatewayHealth(); }
    catch (error) { return { online: false, ready: false, message: error instanceof Error ? error.message : 'Render gateway unavailable.' }; }
  }
  const lifetime = requestLifetime(undefined, 10_000);
  try {
    const res = await fetch(`${RENDER_URL}/health`, { signal: lifetime.signal });
    if (!res.ok) return { online: true, ready: false, message: `Render server returned ${res.status}.` };
    const state = await res.json() as {
      ok?: boolean; ready?: boolean; message?: string; active_renders?: number;
      timeout_seconds?: number; cancellation_supported?: boolean;
    };
    // Older cloud deployments expose only {ok:true}; continue to support them.
    const ready = typeof state.ready === 'boolean' ? state.ready : state.ok === true;
    return {
      online: true, ready,
      message: typeof state.message === 'string' ? state.message : ready ? 'Ready to render' : 'The render server is not ready.',
      activeRenders: state.active_renders,
      timeoutSeconds: state.timeout_seconds,
      cancellationSupported: state.cancellation_supported === true,
    };
  } catch {
    return { online: false, ready: false, message: 'Cannot reach the render server.' };
  } finally {
    lifetime.dispose();
  }
}

export async function checkRenderServer(): Promise<boolean> {
  return (await getRenderServerStatus()).ready;
}
