import { get, set, del } from 'idb-keyval';
import type { SceneData } from './types';

const STORAGE_KEY = 'scenes';

const MODEL_TO_BODY: Record<string, string> = {
  FinalBaseMesh: 'body_full',
  Monk: 'forearm',
};

export function migrateScene(s: SceneData): SceneData {
  return {
    ...s,
    bodyMeshId: s.bodyMeshId ?? MODEL_TO_BODY[s.model] ?? 'body_full',
    skinToneId: s.skinToneId ?? 'tone_03',
    poseId: s.poseId ?? 'neutral',
    lookId: s.lookId ?? 'studio_softbox',
    qualityTier: s.qualityTier ?? 'preview',
  };
}

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
    legacyDecal != null && legacyDecal.length > 0
      ? legacyDecal
      : await loadDataUrl(decalKey(raw.id));
  const thumbnail =
    legacyThumb != null && legacyThumb.length > 0
      ? legacyThumb
      : await loadDataUrl(thumbKey(raw.id));
  return migrateScene({ ...rest, decalImage, thumbnail });
}

async function dehydrateScene(scene: SceneData): Promise<PersistedScene> {
  await storeDataUrl(decalKey(scene.id), scene.decalImage);
  await storeDataUrl(thumbKey(scene.id), scene.thumbnail);
  const { decalImage: _d, thumbnail: _t, ...rest } = scene;
  return rest;
}

export async function loadScenes(): Promise<SceneData[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: RawStoredScene[] = raw ? JSON.parse(raw) : [];
    return Promise.all(parsed.map(hydrateScene));
  } catch {
    return [];
  }
}

export async function saveScenes(scenes: SceneData[]): Promise<void> {
  const persisted = await Promise.all(scenes.map(dehydrateScene));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));
}

export async function addScene(scene: SceneData): Promise<void> {
  const scenes = await loadScenes();
  scenes.push(scene);
  await saveScenes(scenes);
}

export async function updateScene(updated: SceneData): Promise<void> {
  const scenes = await loadScenes();
  const next = scenes.map((s) => (s.id === updated.id ? updated : s));
  await saveScenes(next);
}

export async function deleteScene(id: string): Promise<void> {
  await del(decalKey(id));
  await del(thumbKey(id));
  const scenes = (await loadScenes()).filter((s) => s.id !== id);
  await saveScenes(scenes);
}

export async function getScene(id: string): Promise<SceneData | undefined> {
  const scenes = await loadScenes();
  return scenes.find((s) => s.id === id);
}
