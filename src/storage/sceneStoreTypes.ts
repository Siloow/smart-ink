import { normalizePose, poseFromPreset, BODY_POSE_PRESETS, BODY_POSE_KEYS } from '../render/bodyPose';
import { normalizeShape } from '../render/bodyShape';
import { REGION_INDEX, type BodyRegionId } from '../render/bodyRegions';
import { clampFinalSamples } from '../render/buildContract';
import { FINAL_SAMPLES } from '../render/registry';
import type { SceneData } from '../types';
import { normalizeAppearance } from '../render/bodyAppearance';
import { normalizeStudio } from '../render/studioSettings';

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
  const bodyPose = normalizePose(s.bodyPose ?? poseFromPreset(s.poseId ?? 'neutral'));
  const preset = BODY_POSE_PRESETS.find((entry) => {
    const target = poseFromPreset(entry.id);
    return BODY_POSE_KEYS.every((key) => Math.abs(bodyPose[key] - target[key]) < 0.001);
  });
  return {
    ...s,
    // The forearm and human bodies were replaced by regions of the figure.
    model: 'FinalBaseMesh',
    bodyMeshId: !s.bodyMeshId || RETIRED_BODIES.has(s.bodyMeshId) ? 'body_full' : s.bodyMeshId,
    skinToneId: s.skinToneId ?? 'tone_03',
    poseId: preset?.id ?? 'custom',
    bodyPose,
    bodyAppearance: normalizeAppearance(s.bodyAppearance),
    studio: normalizeStudio(s.studio),
    lookId: s.lookId ?? 'studio_softbox',
    qualityTier: s.qualityTier ?? 'preview',
    finalSamples: clampFinalSamples(s.finalSamples ?? FINAL_SAMPLES.default),
    bodyShape: normalizeShape(s.bodyShape),
    bodyRegion: s.bodyRegion && s.bodyRegion in REGION_INDEX ? (s.bodyRegion as BodyRegionId) : null,
  };
}
