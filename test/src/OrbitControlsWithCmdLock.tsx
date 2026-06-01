import { useEffect, useRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

interface Props {
  cameraState: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  };
  setCameraState: (state: { position: [number, number, number]; target: [number, number, number]; fov: number }) => void;
}

export default function OrbitControlsWithCmdLock({ cameraState, setCameraState }: Props) {
  const controlsRef = useRef<any>(null);
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(...cameraState.position);
    if ((camera as THREE.PerspectiveCamera).isPerspectiveCamera) {
      (camera as THREE.PerspectiveCamera).fov = cameraState.fov;
      (camera as THREE.PerspectiveCamera).updateProjectionMatrix();
    }
    if (controlsRef.current) {
      controlsRef.current.target.set(...cameraState.target);
      controlsRef.current.update();
    }
    // eslint-disable-next-line
  }, [cameraState.position, cameraState.target, cameraState.fov]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && controlsRef.current) {
        controlsRef.current.enabled = false;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (!e.metaKey && controlsRef.current) {
        controlsRef.current.enabled = true;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Listen for camera/controls changes and update state
  useEffect(() => {
    if (!controlsRef.current) return;
    const controls = controlsRef.current;
    const handleChange = () => {
      setCameraState({
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [controls.target.x, controls.target.y, controls.target.z],
        fov: (camera as THREE.PerspectiveCamera).isPerspectiveCamera ? (camera as THREE.PerspectiveCamera).fov : 45,
      });
    };
    controls.addEventListener('change', handleChange);
    return () => controls.removeEventListener('change', handleChange);
  }, [setCameraState, camera]);

  return <OrbitControls ref={controlsRef} />;
} 