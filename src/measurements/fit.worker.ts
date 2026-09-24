import { solveFit, type FitAsset } from './fitter';
self.onmessage = (event: MessageEvent<{ asset: FitAsset; bodyMeshId: string; values: Record<string, number> }>) => {
  try { const { asset, bodyMeshId, values } = event.data, result = solveFit(asset, bodyMeshId, values); self.postMessage({ result }, { transfer: [result.positions.buffer] }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'The body could not be fitted.' }); }
};
