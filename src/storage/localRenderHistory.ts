/** Browser-local render history: a manifest in localStorage, PNG blobs in IndexedDB. */
import { del, get, set } from 'idb-keyval';
import {
  newRenderId,
  type RenderHistoryEntry,
  type RenderHistoryStore,
} from './renderHistoryTypes';

const MANIFEST_KEY = 'render-history-manifest';
const IMAGE_PREFIX = 'render-image:';
const MAX_ENTRIES = 40;

function imageKey(id: string): string {
  return `${IMAGE_PREFIX}${id}`;
}

function loadManifest(): RenderHistoryEntry[] {
  try {
    const raw = localStorage.getItem(MANIFEST_KEY);
    return raw ? (JSON.parse(raw) as RenderHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function saveManifest(entries: RenderHistoryEntry[]): void {
  localStorage.setItem(MANIFEST_KEY, JSON.stringify(entries));
}

export const localRenderHistory: RenderHistoryStore = {
  async list() {
    return loadManifest().sort((a, b) => b.createdAt - a.createdAt);
  },

  async add(meta, image) {
    const entry: RenderHistoryEntry = { ...meta, id: newRenderId(), createdAt: Date.now() };
    await set(imageKey(entry.id), image);
    const manifest = loadManifest();
    manifest.unshift(entry);
    if (manifest.length > MAX_ENTRIES) {
      const removed = manifest.splice(MAX_ENTRIES);
      await Promise.all(removed.map((r) => del(imageKey(r.id))));
    }
    saveManifest(manifest);
    return entry;
  },

  async getImageBlob(id) {
    const blob = await get<Blob>(imageKey(id));
    return blob ?? null;
  },

  async remove(id) {
    await del(imageKey(id));
    saveManifest(loadManifest().filter((e) => e.id !== id));
  },

  async clear() {
    const manifest = loadManifest();
    await Promise.all(manifest.map((e) => del(imageKey(e.id))));
    saveManifest([]);
  },

  async createShareLink() {
    throw new Error('Share links need the hosted backend. Download the image instead.');
  },
};
