import { validateContract } from '../render/buildContract';
import type { RenderContract } from '../render/contract';

const CLOUD_RENDER_URL =
  'https://smart-ink-render-615593848551.europe-west4.run.app';

/** In dev, default to same-origin (Vite proxies /health and /render-v2 → :8000). */
const RENDER_URL =
  import.meta.env.VITE_RENDER_URL ??
  (import.meta.env.DEV ? '' : CLOUD_RENDER_URL);

export function getRenderUrl(): string {
  return RENDER_URL;
}

export function getRenderTargetLabel(): 'local' | 'cloud' {
  if (import.meta.env.DEV && !import.meta.env.VITE_RENDER_URL) return 'local';
  const url = RENDER_URL.toLowerCase();
  if (url.includes('localhost') || url.includes('127.0.0.1')) return 'local';
  return 'cloud';
}

export type RenderStatus = 'idle' | 'uploading' | 'rendering' | 'done' | 'error';

export interface CloudRenderOptions {
  onStatusChange?: (status: RenderStatus, message?: string) => void;
}

export async function renderContract(
  contract: RenderContract,
  inkLayer: Blob,
  opts?: CloudRenderOptions
): Promise<string> {
  const errs = validateContract(contract);
  if (errs.length) throw new Error('Invalid contract: ' + errs.join('; '));

  opts?.onStatusChange?.('uploading', 'Sending shot to render server...');
  const form = new FormData();
  form.append(
    'contract',
    new Blob([JSON.stringify(contract)], { type: 'application/json' }),
    'contract.json'
  );
  form.append('ink_layer', inkLayer, 'ink.png');

  opts?.onStatusChange?.('rendering', 'Rendering with Cycles...');
  const res = await fetch(`${RENDER_URL}/render-v2`, { method: 'POST', body: form });
  if (!res.ok) {
    let msg = 'Render failed';
    const body = await res.text();
    try {
      const j = JSON.parse(body) as { detail?: string | Array<{ msg?: string }>; error?: string };
      if (typeof j.detail === 'string') {
        msg = j.detail;
      } else if (Array.isArray(j.detail)) {
        msg = j.detail.map((d) => d.msg ?? String(d)).join('; ');
      } else if (j.error) {
        msg = j.error;
      }
    } catch {
      if (body) msg = body.slice(0, 500);
    }
    opts?.onStatusChange?.('error', msg);
    throw new Error(msg);
  }
  const blob = await res.blob();
  opts?.onStatusChange?.('done', 'Render complete!');
  return URL.createObjectURL(blob);
}

export async function syncToLiveWatcher(
  contract: RenderContract,
  inkLayer: Blob
): Promise<void> {
  const form = new FormData();
  form.append(
    'contract',
    new Blob([JSON.stringify(contract)], { type: 'application/json' }),
    'contract.json'
  );
  form.append('ink_layer', inkLayer, 'ink.png');

  const res = await fetch(`${RENDER_URL}/sync-live`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text();
    let msg = 'Sync to Blender failed';
    try {
      const j = JSON.parse(body) as { detail?: string };
      if (typeof j.detail === 'string') msg = j.detail;
    } catch {
      if (body) msg = body.slice(0, 500);
    }
    throw new Error(msg);
  }
}

export async function checkRenderServer(): Promise<boolean> {
  try {
    const res = await fetch(`${RENDER_URL}/health`, { signal: AbortSignal.timeout(10000) });
    return res.ok;
  } catch {
    return false;
  }
}
