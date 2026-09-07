/**
 * Render history, hosted or browser-local depending on the beta gate's
 * backend. Cycles renders and canvas exports both land here.
 */
import { authMode } from './auth/betaAuthService';
import { localRenderHistory } from './storage/localRenderHistory';
import { supabaseRenderHistory } from './storage/supabaseRenderHistory';
import type {
  NewRenderHistoryEntry,
  RenderHistoryEntry,
  RenderHistoryStore,
} from './storage/renderHistoryTypes';

export type { NewRenderHistoryEntry, RenderHistoryEntry, RenderSource } from './storage/renderHistoryTypes';

function store(): RenderHistoryStore {
  return authMode() === 'supabase' ? supabaseRenderHistory : localRenderHistory;
}

/** True when share links can be created (hosted backend). */
export function canShareRenders(): boolean {
  return authMode() === 'supabase';
}

export function listRenderHistory(): Promise<RenderHistoryEntry[]> {
  return store().list();
}

export function addRenderHistory(meta: NewRenderHistoryEntry, imageBlob: Blob): Promise<RenderHistoryEntry> {
  return store().add(meta, imageBlob);
}

export function getRenderImageBlob(id: string): Promise<Blob | null> {
  return store().getImageBlob(id);
}

export function deleteRenderHistory(id: string): Promise<void> {
  return store().remove(id);
}

export function clearRenderHistory(): Promise<void> {
  return store().clear();
}

export function createRenderShareLink(id: string): Promise<{ url: string; expiresAt: number }> {
  return store().createShareLink(id);
}
