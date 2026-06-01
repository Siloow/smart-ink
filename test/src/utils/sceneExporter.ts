import type { TattooSceneExport, TattooDecal, BackgroundExport } from '../types/sceneTypes';
import {
  getExportLightsForPreset,
  type LightingPresetKey,
} from '../config/lightingPresets';

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
    aspectRatio: number;
  };
  lightingPresetKey: LightingPresetKey;
  background: BackgroundExport;
  resolution?: [number, number];
  samples?: number;
  outputPath?: string;
  bodyMeshPath?: string;
}

export function exportBackground(bgKey: string): BackgroundExport {
  const map: Record<string, BackgroundExport> = {
    white: { type: 'solid', color: '#ffffff' },
    dark: { type: 'solid', color: '#181818' },
    gray: {
      type: 'gradient',
      gradientStops: [
        { color: '#444444', position: 0 },
        { color: '#888888', position: 1 },
      ],
    },
    bluepurple: {
      type: 'gradient',
      gradientStops: [
        { color: '#3a1c71', position: 0 },
        { color: '#d76d77', position: 0.5 },
        { color: '#ffaf7b', position: 1 },
      ],
    },
    peach: {
      type: 'gradient',
      gradientStops: [
        { color: '#ffecd2', position: 0 },
        { color: '#fcb69f', position: 1 },
      ],
    },
  };
  return map[bgKey] ?? { type: 'solid', color: '#ffffff' };
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
    lightingPresetKey,
    background,
    resolution = [2048, 2048],
    samples = 256,
    outputPath = './renders/output.png',
    bodyMeshPath,
  } = params;

  const lighting = {
    presetName: lightingPresetKey,
    lights: getExportLightsForPreset(lightingPresetKey),
  };

  const decalsExport: TattooDecal[] = decals.map((d) => ({
    imageUrl: d.textureUrl,
    position: d.position,
    rotation: d.rotation,
    scale: d.scale,
    opacity: d.opacity ?? 0.95,
  }));

  return {
    version: '2.0.0',
    bodyMesh: bodyMeshId,
    bodyMeshPath,
    decals: decalsExport,
    lighting,
    camera: {
      position: camera.position,
      target: camera.target,
      fov: camera.fov,
      aspectRatio: camera.aspectRatio,
    },
    background,
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

export type { LightingPresetKey };
