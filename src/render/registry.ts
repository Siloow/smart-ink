import { BODY_POSE_PRESETS } from './bodyPose';
import type { LightingPresetKey } from '../config/lightingPresets';

export type PreviewModel = 'FinalBaseMesh';

export interface BodyMeshDef {
  id: string;
  label: string;
  thumbnail: string;
  previewModel: PreviewModel;
  blendAsset: string;
  /** Draco-compressed GLB the browser loads. Y-up, +Z front, feet at y=0. */
  previewUrl: string;
  /**
   * Tangent-space normals baked from the multires sculpt onto the base cage,
   * so the 10.5k-face browser mesh reads like the 678k-face render mesh.
   */
  normalMapUrl: string;
}
export interface SkinToneDef {
  id: string;
  label: string;
  swatch: string;
  serverShader: string;
}
export interface PoseDef {
  id: string;
  label: string;
  serverPose: string;
}
export interface LookDef {
  id: string;
  label: string;
  thumbnail: string;
  previewLighting: LightingPresetKey;
  previewBackground: string;
  serverWorld: string;
}
export interface OutputTierDef {
  id: 'preview' | 'final';
  label: string;
  samples: number;
}

export const REGISTRY = {
  bodyMeshes: [
    {
      id: 'body_full',
      label: 'Male figure',
      thumbnail: '/builder/body_full.jpg',
      previewModel: 'FinalBaseMesh',
      blendAsset: 'body_full.blend',
      previewUrl: '/models/body_male_realistic.glb',
      normalMapUrl: '/models/body_male_realistic_normal.png',
    },
    {
      id: 'body_full_female',
      label: 'Female figure',
      thumbnail: '/builder/body_full.jpg',
      previewModel: 'FinalBaseMesh',
      blendAsset: 'body_full.blend',
      previewUrl: '/models/body_female_realistic.glb',
      normalMapUrl: '/models/body_female_realistic_normal.png',
    },
  ] as BodyMeshDef[],

  skinTones: [
    { id: 'tone_01', label: 'Fair', swatch: '#f1c9a5', serverShader: 'skin_fair' },
    { id: 'tone_03', label: 'Medium', swatch: '#d4a574', serverShader: 'skin_medium' },
    { id: 'tone_05', label: 'Tan', swatch: '#a9774b', serverShader: 'skin_tan' },
    { id: 'tone_07', label: 'Deep', swatch: '#6b4327', serverShader: 'skin_deep' },
  ] as SkinToneDef[],

  poses: [
    ...BODY_POSE_PRESETS.map(({ id, label }) => ({ id, label, serverPose: id })),
    { id: 'custom', label: 'Custom pose', serverPose: 'custom' },
    { id: 'arm_extended', label: 'Arm extended', serverPose: 'arms_out' },
  ] as PoseDef[],

  looks: [
    {
      id: 'studio_softbox',
      label: 'Studio softbox',
      thumbnail: '/builder/look_studio.jpg',
      previewLighting: 'studio',
      previewBackground: 'white',
      serverWorld: 'world_studio_softbox',
    },
    {
      id: 'window_daylight',
      label: 'Window daylight',
      thumbnail: '/builder/look_window.jpg',
      previewLighting: 'softboxLeft',
      previewBackground: 'gray',
      serverWorld: 'world_window_daylight',
    },
    {
      id: 'dramatic_rim',
      label: 'Dramatic rim',
      thumbnail: '/builder/look_dramatic.jpg',
      previewLighting: 'dramatic',
      previewBackground: 'dark',
      serverWorld: 'world_dramatic_rim',
    },
  ] as LookDef[],

  outputTiers: [
    { id: 'preview', label: 'Fast preview', samples: 16 },
    { id: 'final', label: 'Final', samples: 256 },
  ] as OutputTierDef[],
};

/** Bounds for the final-render quality slider; mirrored by sceneImporter.py. */
export const FINAL_SAMPLES = { min: 64, max: 1024, step: 32, default: 256 } as const;

export const findById = <T extends { id: string }>(list: T[], id: string) =>
  list.find((x) => x.id === id);
