import type { TattooLight } from '../types/sceneTypes';

export type LightDefinition = TattooLight;

export interface LightingPreset {
  name: string;
  /** Max raw Three.js intensity in this preset; relative × scale → Three.js viewport intensities. */
  threeIntensityScale: number;
  lights: LightDefinition[];
}

export type LightingPresetKey =
  | 'studio'
  | 'softboxLeft'
  | 'softboxRight'
  | 'backlight'
  | 'dramatic'
  | 'sunset';

const DEFAULT_AREA: [number, number] = [2.0, 2.0];
const ORIGIN: [number, number, number] = [0, 0, 0];

function norm(scale: number, raw: number): number {
  return raw / scale;
}

/** Canonical lighting presets: positions/colors/types match former CinematicLights.tsx; intensities 0–1 relative within preset. */
export const LIGHTING_PRESETS: Record<LightingPresetKey, LightingPreset> = {
  studio: {
    name: 'Studio (3-point)',
    threeIntensityScale: 1.1,
    lights: [
      {
        type: 'ambient',
        position: [0, 0, 0],
        intensity: norm(1.1, 0.15),
        color: '#ffffff',
        castShadow: false,
      },
      {
        type: 'directional',
        position: [8, 6, 8],
        target: ORIGIN,
        intensity: 1,
        color: '#ffffff',
        castShadow: true,
        blenderAreaSize: DEFAULT_AREA,
      },
      {
        type: 'directional',
        position: [-6, 2, 4],
        target: ORIGIN,
        intensity: norm(1.1, 0.5),
        color: '#aaffee',
        castShadow: false,
        blenderAreaSize: DEFAULT_AREA,
      },
      {
        type: 'directional',
        position: [0, 8, -8],
        target: ORIGIN,
        intensity: norm(1.1, 0.7),
        color: '#ffbbaa',
        castShadow: false,
        blenderAreaSize: DEFAULT_AREA,
      },
    ],
  },
  softboxLeft: {
    name: 'Softbox Left',
    threeIntensityScale: 1.4,
    lights: [
      {
        type: 'ambient',
        position: [0, 0, 0],
        intensity: norm(1.4, 0.12),
        color: '#ffffff',
        castShadow: false,
      },
      {
        type: 'directional',
        position: [-10, 8, 5],
        target: ORIGIN,
        intensity: 1,
        color: '#ffffff',
        castShadow: true,
        blenderAreaSize: DEFAULT_AREA,
      },
      {
        type: 'directional',
        position: [8, 2, 8],
        target: ORIGIN,
        intensity: norm(1.4, 0.3),
        color: '#aaffee',
        castShadow: false,
        blenderAreaSize: DEFAULT_AREA,
      },
    ],
  },
  softboxRight: {
    name: 'Softbox Right',
    threeIntensityScale: 1.4,
    lights: [
      {
        type: 'ambient',
        position: [0, 0, 0],
        intensity: norm(1.4, 0.12),
        color: '#ffffff',
        castShadow: false,
      },
      {
        type: 'directional',
        position: [10, 8, 5],
        target: ORIGIN,
        intensity: 1,
        color: '#ffffff',
        castShadow: true,
        blenderAreaSize: DEFAULT_AREA,
      },
      {
        type: 'directional',
        position: [-8, 2, 8],
        target: ORIGIN,
        intensity: norm(1.4, 0.3),
        color: '#aaffee',
        castShadow: false,
        blenderAreaSize: DEFAULT_AREA,
      },
    ],
  },
  backlight: {
    name: 'Backlight',
    threeIntensityScale: 1.6,
    lights: [
      {
        type: 'ambient',
        position: [0, 0, 0],
        intensity: norm(1.6, 0.1),
        color: '#ffffff',
        castShadow: false,
      },
      {
        type: 'directional',
        position: [0, 10, -12],
        target: ORIGIN,
        intensity: 1,
        color: '#fff8e7',
        castShadow: true,
        blenderAreaSize: DEFAULT_AREA,
      },
      {
        type: 'directional',
        position: [4, 2, 4],
        target: ORIGIN,
        intensity: norm(1.6, 0.2),
        color: '#aaffee',
        castShadow: false,
        blenderAreaSize: DEFAULT_AREA,
      },
    ],
  },
  dramatic: {
    name: 'Dramatic',
    threeIntensityScale: 2,
    lights: [
      {
        type: 'ambient',
        position: [0, 0, 0],
        intensity: norm(2, 0.05),
        color: '#ffffff',
        castShadow: false,
      },
      {
        type: 'spot',
        position: [0, 10, 0],
        target: ORIGIN,
        intensity: 1,
        color: '#ffffff',
        castShadow: true,
        angle: 0.3,
        penumbra: 0.7,
      },
      {
        type: 'directional',
        position: [-6, 2, 4],
        target: ORIGIN,
        intensity: norm(2, 0.3),
        color: '#3344ff',
        castShadow: false,
        blenderAreaSize: DEFAULT_AREA,
      },
    ],
  },
  sunset: {
    name: 'Sunset',
    threeIntensityScale: 1.2,
    lights: [
      {
        type: 'ambient',
        position: [0, 0, 0],
        intensity: norm(1.2, 0.08),
        color: '#ffffff',
        castShadow: false,
      },
      {
        type: 'directional',
        position: [-8, 6, 8],
        target: ORIGIN,
        intensity: 1,
        color: '#ffb37b',
        castShadow: true,
        blenderAreaSize: DEFAULT_AREA,
      },
      {
        type: 'directional',
        position: [8, 2, -8],
        target: ORIGIN,
        intensity: norm(1.2, 0.4),
        color: '#ffd1a1',
        castShadow: false,
        blenderAreaSize: DEFAULT_AREA,
      },
    ],
  },
};

export function resolveRig(preset: LightingPresetKey): LightDefinition[] {
  return LIGHTING_PRESETS[preset].lights.map((l) => ({
    ...l,
    position: [...l.position] as [number, number, number],
    target: l.target ? ([...l.target] as [number, number, number]) : undefined,
  }));
}
