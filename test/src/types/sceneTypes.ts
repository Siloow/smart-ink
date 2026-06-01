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
  type: 'directional' | 'point' | 'spot' | 'ambient';
  position: [number, number, number];
  target?: [number, number, number];
  intensity: number;
  color: string;
  castShadow?: boolean;
  angle?: number;
  penumbra?: number;
  blenderAreaSize?: [number, number];
}

export interface TattooLighting {
  /** Metadata only; Blender uses `lights`. */
  presetName?: string;
  lights: TattooLight[];
}

export interface TattooCamera {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  aspectRatio: number;
}

export interface BackgroundExport {
  type: 'solid' | 'gradient';
  color?: string;
  gradientStops?: Array<{
    color: string;
    position: number;
  }>;
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
  bodyMeshPath?: string;
  decals: TattooDecal[];
  lighting: TattooLighting;
  camera: TattooCamera;
  background: BackgroundExport;
  renderSettings: TattooRenderSettings;
}
