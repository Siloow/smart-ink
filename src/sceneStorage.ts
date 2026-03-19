import type { SceneData } from './types';

const STORAGE_KEY = 'scenes';

export function loadScenes(): SceneData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveScenes(scenes: SceneData[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(scenes));
}

export function addScene(scene: SceneData) {
  const scenes = loadScenes();
  scenes.push(scene);
  saveScenes(scenes);
}

export function updateScene(updated: SceneData) {
  const scenes = loadScenes().map(s => s.id === updated.id ? updated : s);
  saveScenes(scenes);
}

export function deleteScene(id: string) {
  const scenes = loadScenes().filter(s => s.id !== id);
  saveScenes(scenes);
}

export function getScene(id: string): SceneData | undefined {
  return loadScenes().find(s => s.id === id);
} 