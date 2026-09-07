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
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: RawStoredScene[] = raw ? JSON.parse(raw) : [];
    return Promise.all(parsed.map(hydrateScene));
  } catch {
    return [];
  }
}

async function saveScenes(scenes: SceneData[]): Promise<void> {
  const persisted = await Promise.all(scenes.map(dehydrateScene));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

export const localSceneStore: SceneStore = {
  loadScenes,

  async addScene(scene) {
    const scenes = await loadScenes();
    scenes.push(scene);
    await saveScenes(scenes);
  },

  async updateScene(updated) {
    const scenes = await loadScenes();
    await saveScenes(scenes.map((s) => (s.id === updated.id ? updated : s)));
  },

  async deleteScene(id) {
    await del(decalKey(id));
    await del(thumbKey(id));
    const scenes = (await loadScenes()).filter((s) => s.id !== id);
    await saveScenes(scenes);
  },

  async getScene(id) {
    const scenes = await loadScenes();
    return scenes.find((s) => s.id === id);
  },
};
