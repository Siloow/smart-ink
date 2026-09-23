/**
 * Browser-local scene store: the scene list in localStorage, the decal PNG
 * and thumbnail as data URLs in IndexedDB. Used by the demo gate and as the
 * source for the one-time migration into the hosted store.
 */
import { get, set, del } from 'idb-keyval';
import type { SceneData } from '../types';
import { migrateScene, type SceneStore } from './sceneStoreTypes';

const STORAGE_KEY = 'scenes';

type PersistedScene = Omit<SceneData, 'decalImage' | 'thumbnail'>;

function decalKey(sceneId: string) {
  return `decal:${sceneId}`;
}

function thumbKey(sceneId: string) {
  return `thumb:${sceneId}`;
}

async function storeDataUrl(key: string, dataUrl: string | null): Promise<void> {
  if (dataUrl) {
    await set(key, dataUrl);
  } else {
    await del(key);
  }
}

async function loadDataUrl(key: string): Promise<string | null> {
  const value = await get<string>(key);
  return value ?? null;
}

type RawStoredScene = PersistedScene & Partial<Pick<SceneData, 'decalImage' | 'thumbnail'>>;

async function hydrateScene(raw: RawStoredScene): Promise<SceneData> {
  const { decalImage: legacyDecal, thumbnail: legacyThumb, ...rest } = raw;
  const decalImage =
    legacyDecal != null && legacyDecal.length > 0 ? legacyDecal : await loadDataUrl(decalKey(raw.id));
  const thumbnail =
    legacyThumb != null && legacyThumb.length > 0 ? legacyThumb : await loadDataUrl(thumbKey(raw.id));
  return migrateScene({ ...rest, decalImage, thumbnail });
}

async function dehydrateScene(scene: SceneData): Promise<PersistedScene> {
  await storeDataUrl(decalKey(scene.id), scene.decalImage);
  await storeDataUrl(thumbKey(scene.id), scene.thumbnail);
  const { decalImage: _d, thumbnail: _t, ...rest } = scene;
  return rest;
}

async function loadScenes(): Promise<SceneData[]> {
  const raw = localStorage.getItem(STORAGE_KEY);
  const parsed: RawStoredScene[] = raw === null ? [] : JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error('Saved scenes could not be read. Please retry.');
  // Read failures must reject: treating an unavailable collection as empty
  // lets the next successful write erase every previously saved scene.
  return Promise.all(parsed.map(hydrateScene));
}

async function saveScenes(scenes: SceneData[]): Promise<void> {
  const persisted = await Promise.all(scenes.map(dehydrateScene));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

// Each mutation reads and rewrites the collection. Dashboard operations and
// editor saves must share this lock, including after a failed operation.
let mutations: Promise<void> = Promise.resolve();
function mutate(action: () => Promise<void>): Promise<void> {
  const result = mutations.then(action);
  mutations = result.catch(() => {});
  return result;
}

export const localSceneStore: SceneStore = {
  async loadScenes() {
    await mutations;
    return loadScenes();
  },

  addScene(scene) {
    return mutate(async () => {
      const scenes = await loadScenes();
      scenes.push(scene);
      await saveScenes(scenes);
    });
  },

  updateScene(updated) {
    return mutate(async () => {
      const scenes = await loadScenes();
      if (!scenes.some((scene) => scene.id === updated.id)) {
        throw new Error('This scene could not be found. Your changes have not been saved.');
      }
      await saveScenes(scenes.map((s) => (s.id === updated.id ? updated : s)));
    });
  },

  deleteScene(id) {
    return mutate(async () => {
      const scenes = (await loadScenes()).filter((s) => s.id !== id);
      await saveScenes(scenes);
      // Commit the collection before removing images. Failed cleanup only
      // leaves unused blobs; it must not make a completed deletion look failed.
      await Promise.all([del(decalKey(id)), del(thumbKey(id))]).catch(() => {});
    });
  },

  async getScene(id) {
    await mutations;
    const scenes = await loadScenes();
    return scenes.find((s) => s.id === id);
  },
};
