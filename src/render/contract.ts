export const RENDER_SCHEMA_VERSION = 1;

export type QualityTier = 'preview' | 'final';

export interface ContractLight {
  type: 'ambient' | 'directional' | 'spot' | 'point' | 'area';
  position: [number, number, number];
  target?: [number, number, number];
  intensity: number;
  color: string;
  castShadow?: boolean;
  blenderAreaSize?: [number, number];
  angle?: number;
  penumbra?: number;
}

export interface RenderContract {
  schemaVersion: number;
  bodyMeshId: string;
  skinToneId: string;
  poseId: string;
  lookId: string;
  /**
   * Sims-style shape sliders, each in [-1, 1]. Omitted when every value is 0.
   * Applied identically by src/render/bodyShape.ts and sceneImporter.py.
   */
  bodyShape?: Record<string, number>;
  lighting?: {
    presetName: string;
    /** Matches LIGHTING_PRESETS[preset].threeIntensityScale in the browser viewport. */
    intensityScale?: number;
    lights: ContractLight[];
  };
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
