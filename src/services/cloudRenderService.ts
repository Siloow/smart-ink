import { validateContract } from '../render/buildContract';
import type { RenderContract } from '../render/contract';

const RENDER_URL =
  import.meta.env.VITE_RENDER_URL ??
  'https://smart-ink-render-615593848551.europe-west4.run.app';

export function getRenderUrl(): string {
  return RENDER_URL;
}

export function getRenderTargetLabel(): 'local' | 'cloud' {
  const url = RENDER_URL.toLowerCase();
  if (url.includes('localhost') || url.includes('127.0.0.1')) return 'local';
  return 'cloud';
}

export type RenderStatus = 'idle' | 'uploading' | 'rendering' | 'done' | 'error';

export interface CloudRenderOptions {
  onStatusChange?: (status: RenderStatus, message?: string) => void;
}

/**
 * Send scene JSON + decal image to Cloud Run Blender server.
 * Returns a blob URL of the rendered PNG.
 *
 * @param sceneExport - The object returned by exportSceneForBlender()
 * @param decalImageDataUrl - The base64 data URL of the uploaded tattoo image (or null)
 * @param bodyMeshId - "Monk" or "FinalBaseMesh"
 * @param options - Optional status callback
 */
export async function cloudRender(
  sceneExport: object,
  decalImageDataUrl: string | null,
  bodyMeshId: string,
  options?: CloudRenderOptions
): Promise<string> {
  const { onStatusChange } = options || {};

  onStatusChange?.('uploading', 'Sending scene to render server...');

  const formData = new FormData();

  // Scene metadata JSON (the same format exportSceneForBlender produces)
  formData.append(
    'scene_meta',
    new Blob([JSON.stringify(sceneExport)], { type: 'application/json' }),
    'metadata.json'
  );

  // Decal image if present
  if (decalImageDataUrl) {
    const decalBlob = dataUrlToBlob(decalImageDataUrl);
    formData.append('decal_image', decalBlob, 'decal.png');
  }

  // Body mesh identifier
  formData.append('body_mesh_id', bodyMeshId);

  onStatusChange?.('rendering', 'Rendering with Cycles (15-60s)...');

  const response = await fetch(`${RENDER_URL}/render`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    let errorMsg = 'Render failed';
    try {
      const err = await response.json();
      errorMsg = err.error || err.stderr || errorMsg;
    } catch { /* not JSON */ }
    onStatusChange?.('error', errorMsg);
    throw new Error(errorMsg);
  }

  const imageBlob = await response.blob();
  const imageUrl = URL.createObjectURL(imageBlob);
  onStatusChange?.('done', 'Render complete!');
  return imageUrl;
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
    try {
      const j = await res.json();
      msg = j.error || msg;
    } catch {
      /* not JSON */
    }
    opts?.onStatusChange?.('error', msg);
    throw new Error(msg);
  }
  const blob = await res.blob();
  opts?.onStatusChange?.('done', 'Render complete!');
  return URL.createObjectURL(blob);
}

export async function checkRenderServer(): Promise<boolean> {
  try {
    const res = await fetch(`${RENDER_URL}/health`, { signal: AbortSignal.timeout(10000) });
    return res.ok;
  } catch {
    return false;
  }
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

