import type { LightingPresetKey } from '../config/lightingPresets';

export type PreviewModel = 'Monk' | 'FinalBaseMesh' | 'Human';

export interface BodyMeshDef {
  id: string;
  label: string;
  thumbnail: string;
  previewModel: PreviewModel;
  blendAsset: string;
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
      label: 'Full figure',
      thumbnail: '/builder/body_full.jpg',
      previewModel: 'FinalBaseMesh',
      blendAsset: 'body_full.blend',
    },
    {
      id: 'forearm',
      label: 'Forearm',
      thumbnail: '/builder/forearm.jpg',
      previewModel: 'Monk',
      blendAsset: 'forearm.blend',
    },
    {
      id: 'human',
      label: 'Human',
      thumbnail: '/builder/human.jpg',
      previewModel: 'Human',
      blendAsset: 'human.blend',
    },
  ] as BodyMeshDef[],

  skinTones: [
    { id: 'tone_01', label: 'Fair', swatch: '#f1c9a5', serverShader: 'skin_fair' },
    { id: 'tone_03', label: 'Medium', swatch: '#d4a574', serverShader: 'skin_medium' },
    { id: 'tone_05', label: 'Tan', swatch: '#a9774b', serverShader: 'skin_tan' },
    { id: 'tone_07', label: 'Deep', swatch: '#6b4327', serverShader: 'skin_deep' },
  ] as SkinToneDef[],

  poses: [
    { id: 'neutral', label: 'Neutral', serverPose: 'pose_neutral' },
    { id: 'arm_extended', label: 'Arm extended', serverPose: 'pose_arm_extended' },
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

export const findById = <T extends { id: string }>(list: T[], id: string) =>
  list.find((x) => x.id === id);
