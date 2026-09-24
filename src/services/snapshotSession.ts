import type { CloudRenderOptions, RenderStatus, RenderProgress } from './cloudRenderService';
import { snapshotContract, type SnapshotQuality, type SnapshotShot } from '../render/snapshot';
import type { RenderContract } from '../render/contract';

export interface SnapshotState {
  open: boolean;
  mode: 'compose' | 'result';
  status: RenderStatus;
  quality: SnapshotQuality;
  imageUrl: string | null;
  previewUrl: string | null;
  progress: RenderProgress | null;
  imageMatchesView: boolean;
  message: string;
  warning: string;
  startedAt: number;
  aspect: number | null;
}

interface Dependencies {
  render: (contract: RenderContract, ink: Blob, options: CloudRenderOptions) => Promise<string>;
  retain?: (shot: SnapshotShot, imageUrl: string) => Promise<void>;
  revoke?: (url: string) => void;
  now?: () => number;
}

/** Compose freely, then freeze one shot per render/retry with owned cancellation and URLs. */
export function createSnapshotSession({ render, retain, revoke = URL.revokeObjectURL, now = Date.now }: Dependencies) {
  let state: SnapshotState = { open: false, mode: 'compose', status: 'idle', quality: 'quick', imageUrl: null, previewUrl: null, progress: null, imageMatchesView: false, message: '', warning: '', startedAt: 0, aspect: null };
  const listeners = new Set<() => void>();
  let controller: AbortController | null = null;
  let prepare: ((signal: AbortSignal) => Promise<SnapshotShot>) | null = null;
  let frozen: SnapshotShot | null = null;
  let generation = 0;
  let attempt = 0;
  const update = (patch: Partial<SnapshotState>) => {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const releasePreview = () => { if (state.previewUrl) revoke(state.previewUrl); };
  const releaseImage = () => { if (state.imageUrl) revoke(state.imageUrl); };
  const run = async () => {
    if (!state.open || controller || !prepare) return;
    const request = new AbortController();
    const visit = generation;
    const sequence = ++attempt;
    const quality = state.quality;
    controller = request;
    const owns = () => visit === generation && controller === request && !request.signal.aborted;
    if (state.mode === 'compose') frozen = null;
    releasePreview();
    update({ previewUrl: null, progress: null, mode: 'result', status: 'uploading', message: 'Preparing your snapshot…', warning: '', startedAt: now() });
    try {
      // Start preparation synchronously: capture the camera and ink before any await.
      const source = frozen ?? await prepare(request.signal);
      if (!owns()) return;
      frozen = { ...source, contract: structuredClone(source.contract) };
      update({ aspect: frozen.contract.camera.aspect });
      const shot = { ...source, contract: snapshotContract(source.contract, quality) };
      const imageUrl = await render(shot.contract, shot.inkBlob, {
        signal: request.signal,
        onPreview(url) {
          if (!owns()) { revoke(url); return; }
          releasePreview();
          update({ previewUrl: url });
        },
        onProgress(progress) { if (owns()) update({ progress }); },
        onStatusChange(status, message) {
          if (owns() && status !== 'done') update({ status, message: message ?? '' });
        },
      });
      if (!owns()) { revoke(imageUrl); return; }
      releaseImage();
      controller = null;
      update({ status: 'done', imageUrl, imageMatchesView: true, message: 'Snapshot ready.' });
      // History failure must never hide a successful image or block another render.
      try { await retain?.(shot, imageUrl); }
      catch {
        if (visit === generation && sequence === attempt && state.imageUrl === imageUrl) {
          update({ warning: 'Your snapshot is ready to download, but could not be added to history.' });
        }
      }
    } catch (error) {
      if (!owns()) return;
      releasePreview();
      update({ previewUrl: null, progress: null, status: 'error', message: error instanceof Error ? error.message : 'Could not render this snapshot. Please try again.' });
    } finally { if (controller === request) controller = null; }
  };
  return {
    getState: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    open(build: (signal: AbortSignal) => Promise<SnapshotShot>) {
      if (state.open) return;
      generation++;
      prepare = build;
      frozen = null;
      update({ open: true, mode: 'compose', status: 'idle', imageMatchesView: false, message: '', warning: '', aspect: null, startedAt: 0 });
    },
    render: run,
    adjust() {
      if (!state.open || controller) return;
      attempt++;
      frozen = null;
      releasePreview();
      update({ previewUrl: null, progress: null, mode: 'compose', status: 'idle', imageMatchesView: false, message: '', warning: '', aspect: null, startedAt: 0 });
    },
    setQuality(quality: SnapshotQuality) { if (!controller) update({ quality }); },
    cancel() {
      if (!controller) return;
      controller.abort();
      controller = null;
      releasePreview();
      update({ previewUrl: null, progress: null, status: 'cancelled', message: 'Stopped waiting. Cancellation requested; the render may still finish in the background.' });
    },
    close() {
      if (!state.open && !controller) return;
      generation++;
      controller?.abort();
      controller = null;
      prepare = null;
      frozen = null;
      releaseImage();
      releasePreview();
      update({ previewUrl: null, progress: null, open: false, mode: 'compose', status: 'idle', imageUrl: null, imageMatchesView: false, message: '', warning: '', aspect: null });
    },
  };
}
