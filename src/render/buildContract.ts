import { RENDER_SCHEMA_VERSION, type RenderContract, type ContractLight } from './contract';
import { REGISTRY, findById } from './registry';
import { BODY_SHAPE_KEYS, effectiveShape, isDefaultShape, type BodyShape } from './bodyShape';

export interface BuilderState {
  bodyMeshId: string;
  skinToneId: string;
  poseId: string;
  lookId: string;
  qualityTier: 'preview' | 'final';
  bodyShape?: BodyShape;
}
export interface ShotState {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  aspect: number;
  aperture?: number;
  focusDistance?: number;
}

export function buildRenderContract(
  builder: BuilderState,
  shot: ShotState,
  inkTextureUrl: string,
  dims: { width: number; height: number },
  lighting?: { presetName: string; intensityScale?: number; lights: ContractLight[] }
): RenderContract {
  const shape = builder.bodyShape ? effectiveShape(builder.bodyShape, builder.bodyMeshId) : null;
  return {
    schemaVersion: RENDER_SCHEMA_VERSION,
    bodyMeshId: builder.bodyMeshId,
    skinToneId: builder.skinToneId,
    poseId: builder.poseId,
    lookId: builder.lookId,
    ...(shape && !isDefaultShape(shape) ? { bodyShape: { ...shape } } : {}),
    inkTextureUrl,
    camera: { ...shot },
    output: { qualityTier: builder.qualityTier, width: dims.width, height: dims.height },
    ...(lighting ? { lighting } : {}),
  };
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
  if (!c.inkTextureUrl) errs.push('missing inkTextureUrl');
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
