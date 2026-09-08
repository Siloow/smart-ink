import { RENDER_SCHEMA_VERSION, type RenderContract, type ContractLight } from './contract';
import { FINAL_SAMPLES, REGISTRY, findById } from './registry';
import { BODY_SHAPE_KEYS, effectiveShape, isDefaultShape, type BodyShape } from './bodyShape';
import { REGION_INDEX, type BodyRegionId } from './bodyRegions';

export interface BuilderState {
  bodyMeshId: string;
  skinToneId: string;
  poseId: string;
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
    bodyMeshId: builder.bodyMeshId,
    skinToneId: builder.skinToneId,
    poseId: builder.poseId,
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
  return errs;
}
