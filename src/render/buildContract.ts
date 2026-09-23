import { RENDER_SCHEMA_VERSION, type RenderContract, type ContractLight } from './contract';
import { FINAL_SAMPLES, REGISTRY, findById } from './registry';
import { BODY_SHAPE_KEYS, effectiveShape, isDefaultShape, type BodyShape } from './bodyShape';
import { BODY_POSE_BOUNDS, normalizePose, poseBoundsForKey, poseFromPreset, type BodyPose, type BodyPoseKey } from './bodyPose';
import { REGION_INDEX, type BodyRegionId } from './bodyRegions';
import { appearanceValidationErrors, normalizeAppearance, type BodyAppearance } from './bodyAppearance';
import { normalizeStudio, studioValidationErrors, type StudioSettings } from './studioSettings';

export interface BuilderState {
  bodyMeshId: string;
  skinToneId: string;
  poseId: string;
  bodyPose?: BodyPose;
  bodyAppearance?: BodyAppearance;
  studio?: StudioSettings;
  lookId: string;
  qualityTier: 'preview' | 'final';
  /** Cycles samples for the final tier; ignored for previews. */
  finalSamples?: number;
  bodyShape?: BodyShape;
  bodyRegion?: BodyRegionId | null;
}
export interface ShotState {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  aspect: number;
  /** Portrait lens the cinematic render dollies back to, in mm. Defaults to 85. */
  lensMm?: number;
  preserveFraming?: boolean;
  /** f-stop for the cinematic render's depth of field. Defaults to 2.8. */
  aperture?: number;
  /** Focus distance override; by default focus is pulled to the tattoo itself. */
  focusDistance?: number;
}

export function buildRenderContract(
  builder: BuilderState,
  shot: ShotState,
  inkTextureUrl: string,
  dims: { width: number; height: number },
  lighting?: { presetName: string; intensityScale?: number; lights: ContractLight[] }
): RenderContract {
  const shape = builder.bodyShape ? effectiveShape(builder.bodyShape) : null;
  return {
    schemaVersion: RENDER_SCHEMA_VERSION,
    showEyes: true,
    eyeColor: '#634530',
    bodyMeshId: builder.bodyMeshId,
    skinToneId: builder.skinToneId,
    poseId: builder.poseId,
    bodyPose: normalizePose(builder.bodyPose ?? poseFromPreset(builder.poseId)),
    ...(builder.bodyAppearance ? { bodyAppearance: normalizeAppearance(builder.bodyAppearance) } : {}),
    ...(builder.studio ? { studio: normalizeStudio(builder.studio) } : {}),
    lookId: builder.lookId,
    ...(shape && !isDefaultShape(shape) ? { bodyShape: { ...shape } } : {}),
    ...(builder.bodyRegion ? { bodyRegion: builder.bodyRegion } : {}),
    inkTextureUrl,
    camera: { ...shot },
    output: {
      qualityTier: builder.qualityTier,
      width: dims.width,
      height: dims.height,
      ...(builder.qualityTier === 'final' && builder.finalSamples
        ? { samples: clampFinalSamples(builder.finalSamples) }
        : {}),
    },
    ...(lighting ? { lighting } : {}),
  };
}

export function clampFinalSamples(samples: number): number {
  if (!Number.isFinite(samples)) return FINAL_SAMPLES.default;
  return Math.round(Math.min(FINAL_SAMPLES.max, Math.max(FINAL_SAMPLES.min, samples)));
}

export function validateContract(c: RenderContract): string[] {
  const errs: string[] = [];
  if (c.schemaVersion !== RENDER_SCHEMA_VERSION) {
    errs.push(`schemaVersion ${c.schemaVersion} != ${RENDER_SCHEMA_VERSION}`);
  }
  if (!findById(REGISTRY.bodyMeshes, c.bodyMeshId)) errs.push(`unknown bodyMeshId ${c.bodyMeshId}`);
  if (!findById(REGISTRY.skinTones, c.skinToneId)) errs.push(`unknown skinToneId ${c.skinToneId}`);
  if (!findById(REGISTRY.poses, c.poseId)) errs.push(`unknown poseId ${c.poseId}`);
  if (!findById(REGISTRY.looks, c.lookId)) errs.push(`unknown lookId ${c.lookId}`);
  if (c.renderStyle !== undefined && !['preview', 'cinematic'].includes(c.renderStyle)) errs.push('unknown renderStyle');
  if (c.camera.preserveFraming !== undefined && typeof c.camera.preserveFraming !== 'boolean') errs.push('camera.preserveFraming must be a boolean');
  const samples = c.output.samples;
  if (samples !== undefined) {
    if (
      typeof samples !== 'number' ||
      !Number.isFinite(samples) ||
      samples < FINAL_SAMPLES.min ||
      samples > FINAL_SAMPLES.max
    ) {
      errs.push(`output.samples must be a number in [${FINAL_SAMPLES.min}, ${FINAL_SAMPLES.max}]`);
    }
  }
  if (!c.inkTextureUrl) errs.push('missing inkTextureUrl');
  if (c.bodyAppearance !== undefined) errs.push(...appearanceValidationErrors(c.bodyAppearance));
  if (c.studio !== undefined) errs.push(...studioValidationErrors(c.studio));
  if (c.bodyRegion && !(c.bodyRegion in REGION_INDEX)) {
    errs.push(`unknown bodyRegion ${c.bodyRegion}`);
  }
  if (c.bodyShape) {
    for (const [key, value] of Object.entries(c.bodyShape)) {
      if (!(BODY_SHAPE_KEYS as readonly string[]).includes(key)) errs.push(`unknown bodyShape key ${key}`);
      else if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1) {
        errs.push(`bodyShape.${key} must be a number in [-1, 1]`);
      }
    }
  }
  if (c.poseId === 'custom' && c.bodyPose === undefined) errs.push('custom pose requires bodyPose');
  if (c.bodyPose !== undefined && (!c.bodyPose || typeof c.bodyPose !== 'object' || Array.isArray(c.bodyPose))) {
    errs.push('bodyPose must be an object');
  } else if (c.bodyPose) {
    for (const [key, value] of Object.entries(c.bodyPose)) {
      if (!Object.hasOwn(BODY_POSE_BOUNDS, key)) errs.push(`unknown bodyPose key ${key}`);
      else {
        const { min, max } = poseBoundsForKey(key as BodyPoseKey, c.bodyPose);
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
          errs.push(`bodyPose.${key} must be a number in [${min}, ${max}]`);
        }
      }
    }
  }
  return errs;
}
