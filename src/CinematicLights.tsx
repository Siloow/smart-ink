import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { LIGHTING_PRESETS, type LightingPresetKey, type LightDefinition } from './config/lightingPresets';
import { createStudioLightObjects, resolveStudioLightRig } from './render/studioLightRig';

export type { LightingPresetKey };

interface CinematicLightsProps {
  preset: LightingPresetKey;
  lights?: LightDefinition[];
  scale?: number;
  performanceMode?: boolean;
}

export default function CinematicLights({ preset, lights, scale, performanceMode }: CinematicLightsProps) {
  const config = LIGHTING_PRESETS[preset];
  const rig = lights ?? config.lights;
  const intensityScale = scale ?? config.threeIntensityScale;

  const group = useMemo(() => createStudioLightObjects(resolveStudioLightRig(rig, intensityScale), performanceMode), [rig, intensityScale, performanceMode]);
  useEffect(() => () => {
    group.traverse((object) => {
      if (object instanceof THREE.DirectionalLight || object instanceof THREE.PointLight || object instanceof THREE.SpotLight) object.shadow.dispose();
    });
  }, [group]);
  return <primitive object={group} />;
}
