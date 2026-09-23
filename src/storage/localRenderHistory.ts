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
  const raw = localStorage.getItem(MANIFEST_KEY);
  const parsed: RenderHistoryEntry[] = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Saved render history could not be read. Please retry.');
  return parsed;
}

function saveManifest(entries: RenderHistoryEntry[]): void {
  localStorage.setItem(MANIFEST_KEY, JSON.stringify(entries));
}

// Canvas exports, Cycles renders, and history actions can finish together.
// Serialize the entire read/change/write operation, including image eviction.
let mutations: Promise<void> = Promise.resolve();
function mutate<T>(action: () => Promise<T>): Promise<T> {
  const result = mutations.then(action);
  mutations = result.then(() => {}, () => {});
  return result;
}

export const localRenderHistory: RenderHistoryStore = {
  async list() {
    await mutations;
    return loadManifest().sort((a, b) => b.createdAt - a.createdAt);
  },

  add(meta, image) {
    return mutate(async () => {
      const manifest = loadManifest();
      const entry: RenderHistoryEntry = { ...meta, id: newRenderId(), createdAt: Date.now() };
      await set(imageKey(entry.id), image);
      manifest.unshift(entry);
      const removed = manifest.splice(MAX_ENTRIES);
      try {
        saveManifest(manifest);
      } catch (error) {
        // The old manifest still owns all old images. Only this unreferenced
        // new image may be discarded when committing the entry fails.
        await del(imageKey(entry.id)).catch(() => {});
        throw error;
      }
      await Promise.all(removed.map((r) => del(imageKey(r.id)))).catch(() => {});
      return entry;
    });
  },

  async getImageBlob(id) {
    await mutations;
    const blob = await get<Blob>(imageKey(id));
    return blob ?? null;
  },

  remove(id) {
    return mutate(async () => {
      const manifest = loadManifest();
      saveManifest(manifest.filter((e) => e.id !== id));
      await del(imageKey(id)).catch(() => {});
    });
  },

  clear() {
    return mutate(async () => {
      const manifest = loadManifest();
      saveManifest([]);
      await Promise.all(manifest.map((e) => del(imageKey(e.id)))).catch(() => {});
    });
  },

  async createShareLink() {
    throw new Error('Share links need the hosted backend. Download the image instead.');
  },
};
