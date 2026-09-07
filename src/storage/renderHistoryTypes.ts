export type RenderSource = 'cycles' | 'canvas';

export interface RenderHistoryEntry {
  id: string;
  createdAt: number;
  source: RenderSource;
  width: number;
  height: number;
  qualityTier?: 'preview' | 'final';
  lookId?: string;
  sceneName?: string;
  exportPreset?: string;
  /** Object path in the hosted 'renders' bucket; absent for local history. */
  path?: string;
}

export type NewRenderHistoryEntry = Omit<RenderHistoryEntry, 'id' | 'createdAt' | 'path'>;

export interface RenderHistoryStore {
  list(): Promise<RenderHistoryEntry[]>;
  add(meta: NewRenderHistoryEntry, image: Blob): Promise<RenderHistoryEntry>;
  getImageBlob(id: string): Promise<Blob | null>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
  /** A read-only URL anyone can open. Only the hosted store can do this. */
  createShareLink(id: string): Promise<{ url: string; expiresAt: number }>;
}

export function newRenderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}
