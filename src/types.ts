import type { SurfaceAnchor } from './render/surfacePlacement';
import type { BodyRegionId } from './render/bodyRegions';
import type { LightDefinition } from './config/lightingPresets';
import type { BodyAppearance } from './render/bodyAppearance';
import type { StudioSettings } from './render/studioSettings';

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
  /** Seam-free anchor in the original body mesh; survives reopening and reshaping. */
  surfacePlacement?: SurfaceAnchor | null;
  decalPosition: [number, number, number] | null;
  decalNormal: [number, number, number] | null;
  lightingPreset: string;
  /** Customized light positions/rig; absent in older scenes, which use the preset. */
  lights?: LightDefinition[];
  studio?: Partial<StudioSettings>;
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
  /** Bounded joint angles in degrees; absent in older neutral scenes. */
  bodyPose?: Record<string, number>;
  bodyAppearance?: Partial<BodyAppearance>;
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
