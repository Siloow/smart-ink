import type { BodyRegionId } from './render/bodyRegions';
import type { SceneData } from './types';

export const SCENE_TEMPLATES: ReadonlyArray<{ id: string; label: string; detail: string; region: BodyRegionId | null }> = [
  { id: 'blank', label: 'Blank scene', detail: 'A fresh scene, ready for your artwork', region: null },
  { id: 'arm', label: 'Arm', detail: 'An isolated left arm', region: 'armLeft' },
  { id: 'leg', label: 'Leg', detail: 'An isolated left leg', region: 'legLeft' },
  { id: 'torso', label: 'Torso', detail: 'A torso for chest or back designs', region: 'torso' },
];
export type TemplatePreview = { image: string; camera: SceneData['camera'] };
// Reuse the snapshots when returning from the editor, without keeping WebGL alive.
export const templatePreviewCache: Record<string, TemplatePreview> = {};
