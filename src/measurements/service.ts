import type { FitAsset, FitResult } from './fitter';
const assets = new Map<string, Promise<FitAsset>>();
export function loadFitAsset(bodyMeshId: string): Promise<FitAsset> {
  const sex = bodyMeshId === 'body_full_female' ? 'female' : 'male';
  if (!assets.has(sex)) assets.set(sex, (async () => {
    const response = await fetch(`/measurements/${sex}-v1.bin`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok || !response.body) throw new Error('The measuring guide could not load. Please try again.');
    return await new Response(response.body.pipeThrough(new DecompressionStream('gzip'))).json() as FitAsset;
  })().catch(error => { assets.delete(sex); throw error; }));
  return assets.get(sex)!;
}
export async function fitBody(bodyMeshId: string, values: Record<string, number>): Promise<FitResult> {
  const asset = await loadFitAsset(bodyMeshId);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./fit.worker.ts', import.meta.url), { type: 'module' });
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error('Fitting took too long. Please try again.')); }, 60000);
    const finish = () => { clearTimeout(timeout); worker.terminate(); };
    worker.onmessage = e => { finish(); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.result); };
    worker.onerror = () => { finish(); reject(new Error('Fitting failed. Your existing body has been kept.')); };
    worker.postMessage({ asset, bodyMeshId, values });
  });
}
