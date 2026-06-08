export const RENDER_SCHEMA_VERSION = 1;

export type QualityTier = 'preview' | 'final';

export interface RenderContract {
  schemaVersion: number;
  bodyMeshId: string;
  skinToneId: string;
  poseId: string;
  lookId: string;
  /** UV-space RGBA ink layer (tattoo only, transparent elsewhere). Uploaded URL or data URL. */
  inkTextureUrl: string;
  camera: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
    aspect: number;
    aperture?: number;
    focusDistance?: number;
  };
  output: {
    qualityTier: QualityTier;
    width: number;
    height: number;
  };
}
