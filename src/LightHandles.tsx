import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { LightDefinition } from './config/lightingPresets';
import { lightSoftness, selectedLightIndex } from './render/studioLighting';

interface LightHandlesProps {
  lights: LightDefinition[];
  selectedIndex: number | null;
  onSelect: (i: number) => void;
}

const DEFAULT_TARGET: [number, number, number] = [0, 0, 0];

function SoftboxHandle({ light, index, selected, onSelect }: { light: LightDefinition; index: number; selected: boolean; onSelect: (index: number) => void }) {
  const target = light.target ?? DEFAULT_TARGET;
  const quaternion = useMemo(() => {
    const direction = new THREE.Vector3(...target).sub(new THREE.Vector3(...light.position));
    if (direction.lengthSq() < 1e-8) direction.set(0, 0, -1);
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction.normalize());
  }, [light.position, target]);
  const lineGeometry = useMemo(() => new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...light.position), new THREE.Vector3(...target)]), [light.position, target]);
  useEffect(() => () => lineGeometry.dispose(), [lineGeometry]);
  const metadata = { editorHelper: true, studioLightHandle: true, lightIndex: index };
  const width = .42 + lightSoftness(light) * .48, enabled = light.enabled !== false;
  const frameColor = selected ? '#d7b98a' : '#636e81';
  return <group userData={metadata}>
    {selected && <lineSegments geometry={lineGeometry} raycast={() => {}} userData={{ editorHelper: true }}>
      <lineBasicMaterial color={frameColor} transparent opacity={enabled ? .4 : .15} depthWrite={false} />
    </lineSegments>}
    <group position={light.position} quaternion={quaternion} userData={metadata} onPointerDown={(event) => { event.stopPropagation(); onSelect(index); }} onClick={(event) => { event.stopPropagation(); onSelect(index); }}>
      <mesh userData={metadata}>
        <boxGeometry args={[width + .07, width * .72 + .07, .065]} />
        <meshBasicMaterial color={frameColor} transparent opacity={enabled ? 1 : .5} />
      </mesh>
      <mesh position={[0, 0, .036]} userData={metadata}>
        <planeGeometry args={[width, width * .72]} />
        <meshBasicMaterial color={enabled ? light.color : '#454b55'} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0, -.037]} userData={metadata}>
        <planeGeometry args={[width, width * .72]} />
        <meshBasicMaterial color="#252b34" side={THREE.DoubleSide} />
      </mesh>
    </group>
    {selected && <mesh position={target} raycast={() => {}} userData={{ editorHelper: true }}>
      <sphereGeometry args={[.055, 10, 8]} /><meshBasicMaterial color={frameColor} transparent opacity={.7} depthWrite={false} />
    </mesh>}
  </group>;
}

export default function LightHandles({ lights, selectedIndex, onSelect }: LightHandlesProps) {
  const selected = selectedLightIndex(lights, selectedIndex);
  return <>{lights.map((light, index) => light.type === 'ambient' ? null : <SoftboxHandle key={index} light={light} index={index} selected={index === selected} onSelect={onSelect} />)}</>;
}
