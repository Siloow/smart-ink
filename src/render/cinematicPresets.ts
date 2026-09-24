import * as THREE from 'three';
import type { LightDefinition } from '../config/lightingPresets';
import type { CameraView } from './cameraTransition';
import type { TattooCameraAdjustment } from './tattooCamera';

export type CinematicPresetId = 'editorial' | 'sculpted' | 'detail';
export interface CinematicPreset {
  id: CinematicPresetId; name: string; description: string; fov: number; aperture: number;
  adjustment: TattooCameraAdjustment; background: string;
  key: [number, number, number, number]; fill: number; rim: number;
}
export const CINEMATIC_PRESETS: CinematicPreset[] = [
  { id: 'editorial', name: 'Editorial', description: 'Soft light · complete design', fov: 27, aperture: 8,
    adjustment: { azimuth: -12, elevation: 6, zoom: 1 }, background: '#323337', key: [-3, 2.6, 3.8, .95], fill: .14, rim: .3 },
  { id: 'sculpted', name: 'Sculpted light', description: 'Deep shadows · angled view', fov: 24, aperture: 6.3,
    adjustment: { azimuth: 24, elevation: 8, zoom: 1.05 }, background: '#12151b', key: [-4, 1.8, 1.8, 1.05], fill: .055, rim: .45 },
  { id: 'detail', name: 'Ink detail', description: 'Tight crop · skin texture', fov: 25, aperture: 11,
    adjustment: { azimuth: -22, elevation: 4, zoom: 1.45 }, background: '#292622', key: [3.3, 1.6, 2.4, .9], fill: .1, rim: .22 },
];
export function cinematicPreset(id: string | null) { return CINEMATIC_PRESETS.find(p => p.id === id); }
/** Rotate a controlled studio rig around the shot, including tattoos on the back/limbs. */
export function cinematicLights(preset: CinematicPreset, camera: CameraView, intensityScale = 1.1): LightDefinition[] {
  const target = new THREE.Vector3(...camera.target), front = new THREE.Vector3(...camera.position).sub(target).normalize();
  const right = new THREE.Vector3().crossVectors(Math.abs(front.y) > .98 ? new THREE.Vector3(0,0,1) : new THREE.Vector3(0,1,0), front).normalize();
  const up = new THREE.Vector3().crossVectors(front, right).normalize();
  const light = (name: string, offset: number[], intensity: number, color: string, size: [number,number]): LightDefinition => ({
    name, type: 'directional', position: target.clone().addScaledVector(right,offset[0]).addScaledVector(up,offset[1]).addScaledVector(front,offset[2]).toArray() as [number,number,number],
    target: [...camera.target], intensity: intensity/intensityScale, color, castShadow: true, blenderAreaSize: size, softness: Math.min(1,(Math.min(...size)-.25)/3.75),
  });
  return [
    { name: 'Room fill', type: 'ambient', position: [0,0,0], intensity: .025/intensityScale, color: '#ffffff' },
    light('Key softbox', preset.key, preset.key[3], '#fffaf6', preset.id === 'sculpted' ? [1.1,2.8] : [2.3,3]),
    light('Soft fill', [3,.3,3], preset.fill, '#e1e9ff', [3,3]),
    light('Edge light', [2.3,1,-2.2], preset.rim, '#e9efff', [.8,2.8]),
  ];
}
