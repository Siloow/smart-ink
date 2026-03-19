// Types for scene export from Three.js to Blender (realistic render pipeline)

export interface Vector3 {
  x: number;
  y: number;
  z: number;
}

export interface Euler {
  x: number;
  y: number;
  z: number;
  order: 'XYZ' | 'YXZ' | 'ZXY' | 'ZYX' | 'YZX' | 'XZY';
}

export interface Transform {
  position: Vector3;
  rotation: Euler;
  scale: Vector3;
}

export interface TattooDecal {
  imageUrl: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number];
  opacity?: number;
}

export interface TattooLight {
  type: 'area' | 'point' | 'spot' | 'directional' | 'ambient';
  position: [number, number, number];
  intensity: number;
  color: string;
  castShadow?: boolean;
}

export interface TattooLighting {
  preset?: 'studio' | 'soft' | 'dramatic' | 'neutral' | 'custom';
  lights: TattooLight[];
}

export interface TattooCamera {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export interface TattooRenderSettings {
  resolution: [number, number];
  samples: number;
  outputFormat?: 'PNG' | 'JPEG' | 'EXR';
  outputPath?: string;
}

export interface TattooSceneExport {
  version: string;
  bodyMesh: string;
  decals: TattooDecal[];
  lighting: TattooLighting;
  camera: TattooCamera;
  renderSettings: TattooRenderSettings;
  bodyMeshPath?: string;
}
