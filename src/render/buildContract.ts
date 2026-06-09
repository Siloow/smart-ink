import { RENDER_SCHEMA_VERSION, type RenderContract, type ContractLight } from './contract';
import { REGISTRY, findById } from './registry';

export interface BuilderState {
  bodyMeshId: string;
  skinToneId: string;
  poseId: string;
  lookId: string;
  qualityTier: 'preview' | 'final';
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
  lighting?: { presetName: string; lights: ContractLight[] }
): RenderContract {
  return {
    schemaVersion: RENDER_SCHEMA_VERSION,
    bodyMeshId: builder.bodyMeshId,
    skinToneId: builder.skinToneId,
    poseId: builder.poseId,
    lookId: builder.lookId,
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
  return errs;
}
