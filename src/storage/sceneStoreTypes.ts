import type { SceneData } from '../types';

export interface SceneStore {
  loadScenes(): Promise<SceneData[]>;
  addScene(scene: SceneData): Promise<void>;
  updateScene(scene: SceneData): Promise<void>;
  deleteScene(id: string): Promise<void>;
  getScene(id: string): Promise<SceneData | undefined>;
}

const MODEL_TO_BODY: Record<string, string> = {
  FinalBaseMesh: 'body_full',
  Monk: 'forearm',
  Human: 'human',
};

/** Fills in fields added after a scene was saved. */
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
