import React from 'react';

export type LightingPresetKey = 'studio' | 'softboxLeft' | 'softboxRight' | 'backlight' | 'dramatic' | 'sunset';

interface CinematicLightsProps {
  preset: LightingPresetKey;
  performanceMode?: boolean;
}

export default function CinematicLights({ preset, performanceMode }: CinematicLightsProps) {
  const shadow = !performanceMode;
  const intensity = performanceMode ? 0.5 : 1;
  switch (preset) {
    case 'studio':
      return (
        <>
          <ambientLight intensity={0.15 * intensity} />
          {/* Key */}
          <directionalLight position={[8, 6, 8]} intensity={1.1 * intensity} castShadow={shadow} shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
          {/* Fill */}
          <directionalLight position={[-6, 2, 4]} intensity={0.5 * intensity} color="#aaffee" />
          {/* Back */}
          <directionalLight position={[0, 8, -8]} intensity={0.7 * intensity} color="#ffbbaa" />
        </>
      );
    case 'softboxLeft':
      return (
        <>
          <ambientLight intensity={0.12 * intensity} />
          <directionalLight position={[-10, 8, 5]} intensity={1.4 * intensity} castShadow={shadow} shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
          <directionalLight position={[8, 2, 8]} intensity={0.3 * intensity} color="#aaffee" />
        </>
      );
    case 'softboxRight':
      return (
        <>
          <ambientLight intensity={0.12 * intensity} />
          <directionalLight position={[10, 8, 5]} intensity={1.4 * intensity} castShadow={shadow} shadow-mapSize-width={2048} shadow-mapSize-height={2048} />
          <directionalLight position={[-8, 2, 8]} intensity={0.3 * intensity} color="#aaffee" />
        </>
      );
    case 'backlight':
      return (
        <>
          <ambientLight intensity={0.1 * intensity} />
          <directionalLight position={[0, 10, -12]} intensity={1.6 * intensity} color="#fff8e7" castShadow={shadow} />
          <directionalLight position={[4, 2, 4]} intensity={0.2 * intensity} color="#aaffee" />
        </>
      );
    case 'dramatic':
      return (
        <>
          <ambientLight intensity={0.05 * intensity} />
          <spotLight position={[0, 10, 0]} angle={0.3} penumbra={0.7} intensity={2 * intensity} castShadow={shadow} />
          <directionalLight position={[-6, 2, 4]} intensity={0.3 * intensity} color="#3344ff" />
        </>
      );
    case 'sunset':
      return (
        <>
          <ambientLight intensity={0.08 * intensity} />
          <directionalLight position={[-8, 6, 8]} intensity={1.2 * intensity} color="#ffb37b" castShadow={shadow} />
          <directionalLight position={[8, 2, -8]} intensity={0.4 * intensity} color="#ffd1a1" />
        </>
      );
    default:
      return null;
  }
} 