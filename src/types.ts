export interface SceneData {
  id: string;
  name: string;
  model: 'Monk' | 'FinalBaseMesh' | 'Human';
  decalImage: string | null;
  decalRotation: number;
  decalScale: number;
  decalColor: string;
  decalOpacity: number;
  decalVisible: boolean;
  decalPosition: [number, number, number] | null;
  decalNormal: [number, number, number] | null;
  lightingPreset: string;
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
  lookId?: string;
  qualityTier?: 'preview' | 'final';
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
}
