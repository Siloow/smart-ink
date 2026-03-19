import type {
  TattooSceneExport,
  TattooDecal,
  TattooLighting,
} from '../types/sceneTypes';

/** Default lighting presets for tattoo/studio renders (Three.js positions, Y-up). */
export function getLightingPreset(
  preset: 'studio' | 'soft' | 'dramatic' | 'neutral' | 'custom'
): TattooLighting {
  const lights = {
    studio: [
      {
        type: 'area' as const,
        position: [2, 3, 1] as [number, number, number],
        intensity: 800,
        color: '#ffffff',
        castShadow: true,
      },
      {
        type: 'area' as const,
        position: [-1.5, 2, 1] as [number, number, number],
        intensity: 300,
        color: '#ffffff',
      },
      {
        type: 'ambient' as const,
        position: [0, 0, 0] as [number, number, number],
        intensity: 0.15,
        color: '#ffffff',
      },
    ],
    soft: [
      {
        type: 'area' as const,
        position: [0, 4, 2] as [number, number, number],
        intensity: 600,
        color: '#fff5e6',
        castShadow: true,
      },
      {
        type: 'point' as const,
        position: [-2, 1, 1] as [number, number, number],
        intensity: 200,
        color: '#ffffff',
      },
      {
        type: 'ambient' as const,
        position: [0, 0, 0] as [number, number, number],
        intensity: 0.25,
        color: '#ffffff',
      },
    ],
    dramatic: [
      {
        type: 'directional' as const,
        position: [3, 5, 2] as [number, number, number],
        intensity: 1.2,
        color: '#ffffff',
        castShadow: true,
      },
      {
        type: 'point' as const,
        position: [-2, 0.5, 0] as [number, number, number],
        intensity: 80,
        color: '#ffeedd',
      },
      {
        type: 'ambient' as const,
        position: [0, 0, 0] as [number, number, number],
        intensity: 0.05,
        color: '#ffffff',
      },
    ],
    neutral: [
      {
        type: 'area' as const,
        position: [2, 2.5, 2] as [number, number, number],
        intensity: 500,
        color: '#ffffff',
        castShadow: true,
      },
      {
        type: 'ambient' as const,
        position: [0, 0, 0] as [number, number, number],
        intensity: 0.2,
        color: '#ffffff',
      },
    ],
    custom: [],
  };
  return { preset, lights: lights[preset] };
}

/** Map app lighting preset keys to Blender pipeline presets. */
export function mapLightingPresetToBlender(
  appPreset: string
): 'studio' | 'soft' | 'dramatic' | 'neutral' | 'custom' {
  const map: Record<string, 'studio' | 'soft' | 'dramatic' | 'neutral' | 'custom'> = {
    studio: 'studio',
    softboxLeft: 'soft',
    softboxRight: 'soft',
    backlight: 'neutral',
    dramatic: 'dramatic',
    sunset: 'soft',
  };
  return map[appPreset] ?? 'studio';
}

export interface ExportForBlenderParams {
  bodyMeshId: string;
  decals: Array<{
    textureUrl: string;
    position: [number, number, number];
    rotation: [number, number, number];
    scale: [number, number];
    opacity?: number;
  }>;
  camera: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  };
  lightingPreset?: 'studio' | 'soft' | 'dramatic' | 'neutral' | 'custom';
  resolution?: [number, number];
  samples?: number;
  outputPath?: string;
  bodyMeshPath?: string;
}

/**
 * Build tattoo-format scene export for Blender (body mesh + decals + camera + lighting).
 * Use with the Blender sceneImporter.py script for realistic rendering.
 */
export function exportSceneForBlender(params: ExportForBlenderParams): TattooSceneExport {
  const {
    bodyMeshId,
    decals,
    camera,
    lightingPreset = 'studio',
    resolution = [2048, 2048],
    samples = 256,
    outputPath = './renders/output.png',
    bodyMeshPath,
  } = params;

  const lighting = getLightingPreset(lightingPreset);

  const decalsExport: TattooDecal[] = decals.map((d) => ({
    imageUrl: d.textureUrl,
    position: d.position,
    rotation: d.rotation,
    scale: d.scale,
    opacity: d.opacity ?? 0.95,
  }));

  return {
    version: '1.0.0',
    bodyMesh: bodyMeshId,
    bodyMeshPath,
    decals: decalsExport,
    lighting,
    camera: {
      position: camera.position,
      target: camera.target,
      fov: camera.fov,
    },
    renderSettings: {
      resolution,
      samples,
      outputFormat: 'PNG',
      outputPath,
    },
  };
}

/** Download JSON file with given filename and content. */
export function downloadJSON(filename: string, data: object): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Download a blob as a file (e.g. decal image). */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
