import type { BodyRegionId } from './render/bodyRegions';

export interface SceneData {
  id: string;
  name: string;
  /** Only one body ships now; kept so older saved scenes still parse. */
  model: 'FinalBaseMesh';
  decalImage: string | null;
  decalRotation: number;
  decalScale: number;
  decalColor: string;
  decalOpacity: number;
  decalVisible: boolean;
  decalPosition: [number, number, number] | null;
  decalNormal: [number, number, number] | null;
  lightingPreset: string;
  background: string;
  thumbnail: string | null;
  camera: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  };
  bodyMeshId?: string;
  skinToneId?: string;
  poseId?: string;
  lookId?: string;
  qualityTier?: 'preview' | 'final';
  /** Cycles samples for the final tier; see FINAL_SAMPLES in render/registry.ts. */
  finalSamples?: number;
  /** Sims-style shape sliders; see src/render/bodyShape.ts. */
  bodyShape?: Record<string, number>;
  /** Body part cut out in the editor, or null/absent for the whole figure. */
  bodyRegion?: BodyRegionId | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
