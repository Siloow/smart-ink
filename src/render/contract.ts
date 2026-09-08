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
  /**
   * Region to cut out ('head', 'torso', 'armLeft', …). Omitted for the whole
   * figure. sceneImporter.py deletes everything else before rendering.
   */
  bodyRegion?: string;
  lighting?: {
    presetName: string;
    /** Matches LIGHTING_PRESETS[preset].threeIntensityScale in the browser viewport. */
    intensityScale?: number;
    lights: ContractLight[];
  };
  /** UV-space RGBA ink layer (tattoo only, transparent elsewhere). Uploaded URL or data URL. */
  inkTextureUrl: string;
  /** Place eyeballs in the sockets. Off by default; the sculpt renders lids-closed. */
  showEyes?: boolean;
  /** Iris colour, as an sRGB hex. Only applies when showEyes is set. Defaults to dark brown. */
  eyeColor?: string;
  /** Hair colour: 'black' | 'dark_brown' | 'brown' | 'auburn' | 'blond' | 'grey'. */
  hairTone?: string;
  camera: {
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
  };
  output: {
    qualityTier: QualityTier;
    width: number;
    height: number;
    /**
     * Cycles sample override for the final tier, within FINAL_SAMPLES bounds.
     * Absent means the tier's own sample count (see registry.outputTiers).
     */
    samples?: number;
  };
}
