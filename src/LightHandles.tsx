import type { LightDefinition } from './config/lightingPresets';

interface LightHandlesProps {
  lights: LightDefinition[];
  selectedIndex: number | null;
  onSelect: (i: number) => void;
}

export default function LightHandles({ lights, selectedIndex, onSelect }: LightHandlesProps) {
  return (
    <>
      {lights.map((l, i) =>
        l.type === 'ambient' ? null : (
          <mesh
            key={i}
            position={l.position}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(i);
            }}
          >
            <sphereGeometry args={[0.25, 16, 16]} />
            <meshBasicMaterial color={i === selectedIndex ? '#ffd23f' : l.color} />
          </mesh>
        )
      )}
    </>
  );
}
