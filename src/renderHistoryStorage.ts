import { del, get, set } from 'idb-keyval';

const MANIFEST_KEY = 'render-history-manifest';
const IMAGE_PREFIX = 'render-image:';
const MAX_ENTRIES = 40;

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
}

function imageKey(id: string): string {
  return `${IMAGE_PREFIX}${id}`;
}

function newRenderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function loadManifest(): Promise<RenderHistoryEntry[]> {
  try {
    const raw = localStorage.getItem(MANIFEST_KEY);
    return raw ? (JSON.parse(raw) as RenderHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

async function saveManifest(entries: RenderHistoryEntry[]): Promise<void> {
  localStorage.setItem(MANIFEST_KEY, JSON.stringify(entries));
}

export async function listRenderHistory(): Promise<RenderHistoryEntry[]> {
  const entries = await loadManifest();
  return entries.sort((a, b) => b.createdAt - a.createdAt);
}

export type NewRenderHistoryEntry = Omit<RenderHistoryEntry, 'id' | 'createdAt'>;

export async function addRenderHistory(
  meta: NewRenderHistoryEntry,
  imageBlob: Blob
): Promise<RenderHistoryEntry> {
  const entry: RenderHistoryEntry = {
    ...meta,
    id: newRenderId(),
    createdAt: Date.now(),
  };
  await set(imageKey(entry.id), imageBlob);
  const manifest = await loadManifest();
  manifest.unshift(entry);
  if (manifest.length > MAX_ENTRIES) {
    const removed = manifest.splice(MAX_ENTRIES);
    await Promise.all(removed.map((r) => del(imageKey(r.id))));
  }
  await saveManifest(manifest);
  return entry;
}

export async function getRenderImageBlob(id: string): Promise<Blob | null> {
  const blob = await get<Blob>(imageKey(id));
  return blob ?? null;
}

export async function deleteRenderHistory(id: string): Promise<void> {
  await del(imageKey(id));
  const manifest = (await loadManifest()).filter((e) => e.id !== id);
  await saveManifest(manifest);
}

export async function clearRenderHistory(): Promise<void> {
  const manifest = await loadManifest();
  await Promise.all(manifest.map((e) => del(imageKey(e.id))));
  await saveManifest([]);
}
