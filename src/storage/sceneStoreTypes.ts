import { normalizeShape } from '../render/bodyShape';
import { REGION_INDEX, type BodyRegionId } from '../render/bodyRegions';
import type { SceneData } from '../types';

export interface SceneStore {
  loadScenes(): Promise<SceneData[]>;
  addScene(scene: SceneData): Promise<void>;
  updateScene(scene: SceneData): Promise<void>;
  deleteScene(id: string): Promise<void>;
  getScene(id: string): Promise<SceneData | undefined>;
}

/** Bodies that existed before the figure was cut into regions. */
const RETIRED_BODIES = new Set(['forearm', 'human']);

/** Fills in fields added after a scene was saved. */
export function migrateScene(s: SceneData): SceneData {
  return {
    ...s,
    // The forearm and human bodies were replaced by regions of the figure.
    model: 'FinalBaseMesh',
    bodyMeshId: !s.bodyMeshId || RETIRED_BODIES.has(s.bodyMeshId) ? 'body_full' : s.bodyMeshId,
    skinToneId: s.skinToneId ?? 'tone_03',
    poseId: s.poseId ?? 'neutral',
    lookId: s.lookId ?? 'studio_softbox',
    qualityTier: s.qualityTier ?? 'preview',
    bodyShape: normalizeShape(s.bodyShape),
    bodyRegion: s.bodyRegion && s.bodyRegion in REGION_INDEX ? (s.bodyRegion as BodyRegionId) : null,
  };
}
