import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { createStudioSweepGeometry, createStudioShadowMaterial, studioFloor } from './render/studioGeometry';
import type { StudioSettings } from './render/studioSettings';
import type { BodyRegionId } from './render/bodyRegions';

export default function StudioBackdrop({ studio, isolateRegion, performanceMode }: {
  studio: StudioSettings; isolateRegion: BodyRegionId | null; performanceMode: boolean;
}) {
  const scene = useThree(state => state.scene);
  useEffect(() => {
    if (studio.mode !== 'sweep') return;
    const previous = scene.background, color = new THREE.Color(studio.color);
    scene.background = color;
    return () => { if (scene.background === color) scene.background = previous; };
  }, [scene, studio.mode, studio.color]);
  const stage = useMemo(() => {
    const geometry = createStudioSweepGeometry(4.2, 8);
    const paper = new THREE.MeshStandardMaterial({ color: '#d6cdc1', roughness: .98, metalness: 0, side: THREE.DoubleSide });
    const shadow = createStudioShadowMaterial();
    const sweep = new THREE.Mesh(geometry, paper), shadows = new THREE.Mesh(geometry, shadow);
    shadows.receiveShadow = true; shadows.renderOrder = 1;
    const group = new THREE.Group(); group.name = 'Photo studio backdrop'; group.userData.studioBackdrop = true;
    group.add(sweep, shadows); group.visible = false;
    return { group, sweep, shadows, paper, shadow, dimensions: '' };
  }, []);
  useEffect(() => {
    stage.paper.color.set(studio.color); stage.shadow.opacity = studio.shadow;
    stage.shadows.visible = studio.shadow > 0 && !performanceMode;
  }, [stage, studio.color, studio.shadow, performanceMode]);
  useEffect(() => () => { stage.sweep.geometry.dispose(); stage.paper.dispose(); stage.shadow.dispose(); }, [stage]);
  useFrame(({ scene, camera }) => {
    if (studio.mode !== 'sweep' || isolateRegion) { stage.group.visible = false; return; }
    let body: THREE.Mesh | null = null;
    scene.traverse(object => { if (object.userData.smartInkBody) body = object as THREE.Mesh; });
    const floor = body ? studioFloor(body) : null;
    if (!floor || camera.position.y < floor.floor + .05) { stage.group.visible = false; return; }
    const distance = camera.position.length(), key = `${floor.height.toFixed(2)}:${distance.toFixed(1)}`;
    if (key !== stage.dimensions) {
      const geometry = createStudioSweepGeometry(floor.height, distance);
      stage.sweep.geometry.dispose(); stage.sweep.geometry = stage.shadows.geometry = geometry;
      stage.dimensions = key;
    }
    stage.group.position.y = floor.floor;
    stage.group.rotation.y = Math.atan2(camera.position.x, camera.position.z);
    stage.group.visible = true;
    stage.group.updateMatrixWorld(true);
  });
  return <primitive object={stage.group} />;
}
