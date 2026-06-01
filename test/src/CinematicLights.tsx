import React from 'react';
import { LIGHTING_PRESETS, type LightingPresetKey } from './config/lightingPresets';

export type { LightingPresetKey };

interface CinematicLightsProps {
  preset: LightingPresetKey;
  performanceMode?: boolean;
}

export default function CinematicLights({ preset, performanceMode }: CinematicLightsProps) {
  const perf = performanceMode ? 0.5 : 1;
  const config = LIGHTING_PRESETS[preset];

  return (
    <>
      {config.lights.map((light, i) => {
        const threeIntensity = light.intensity * config.threeIntensityScale * perf;
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
              />
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
              />
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
