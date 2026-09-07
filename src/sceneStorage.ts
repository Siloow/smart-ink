/**
 * Scene persistence, picked by the same switch as the beta gate: the hosted
 * store when Supabase is configured, the browser-local one otherwise. The
 * workspace only ever calls these functions.
 */
import { authMode } from './auth/betaAuthService';
import { localSceneStore } from './storage/localSceneStore';
import { supabaseSceneStore } from './storage/supabaseSceneStore';
import type { SceneStore } from './storage/sceneStoreTypes';
import type { SceneData } from './types';

export { migrateScene } from './storage/sceneStoreTypes';

function store(): SceneStore {
  return authMode() === 'supabase' ? supabaseSceneStore : localSceneStore;
}

export function loadScenes(): Promise<SceneData[]> {
  return store().loadScenes();
}

export function addScene(scene: SceneData): Promise<void> {
  return store().addScene(scene);
}

export function updateScene(scene: SceneData): Promise<void> {
  return store().updateScene(scene);
}

export function deleteScene(id: string): Promise<void> {
  return store().deleteScene(id);
}

export function getScene(id: string): Promise<SceneData | undefined> {
  return store().getScene(id);
}
