import React from 'react';
import { LIGHTING_PRESETS, type LightingPresetKey, type LightDefinition } from './config/lightingPresets';

export type { LightingPresetKey };

interface CinematicLightsProps {
  preset: LightingPresetKey;
  lights?: LightDefinition[];
  scale?: number;
  performanceMode?: boolean;
}

export default function CinematicLights({ preset, lights, scale, performanceMode }: CinematicLightsProps) {
  const perf = performanceMode ? 0.5 : 1;
  const config = LIGHTING_PRESETS[preset];
  const rig = lights ?? config.lights;
  const intensityScale = scale ?? config.threeIntensityScale;

  return (
    <>
      {rig.map((light, i) => {
        const threeIntensity = light.intensity * intensityScale * perf;
        const shadow = !performanceMode && (light.castShadow ?? false);
        const key = `${preset}-${i}-${light.type}`;

        switch (light.type) {
          case 'ambient':
            return <ambientLight key={key} intensity={threeIntensity} color={light.color} />;
          case 'directional':
            return (
              <directionalLight
                key={key}
                position={light.position}
                intensity={threeIntensity}
                color={light.color}
                castShadow={shadow}
                shadow-mapSize-width={2048}
                shadow-mapSize-height={2048}
              >
                <object3D position={light.target ?? [0, 0, 0]} />
              </directionalLight>
            );
          case 'spot':
            return (
              <spotLight
                key={key}
                position={light.position}
                angle={light.angle ?? Math.PI / 6}
                penumbra={light.penumbra ?? 0.5}
                intensity={threeIntensity}
                color={light.color}
                castShadow={shadow}
              >
                <object3D position={light.target ?? [0, 0, 0]} />
              </spotLight>
            );
          case 'point':
            return (
              <pointLight
                key={key}
                position={light.position}
                intensity={threeIntensity}
                color={light.color}
                castShadow={shadow}
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}
