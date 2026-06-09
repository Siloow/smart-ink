import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

export interface CameraSnapshot {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  aspect: number;
}

export interface OrbitControlsHandle {
  getSnapshot: () => CameraSnapshot;
}

interface Props {
  cameraState: {
    position: [number, number, number];
    target: [number, number, number];
    fov: number;
  };
  setCameraState: (state: { position: [number, number, number]; target: [number, number, number]; fov: number }) => void;
}

const OrbitControlsWithCmdLock = forwardRef<OrbitControlsHandle, Props>(function OrbitControlsWithCmdLock(
  { cameraState, setCameraState },
  ref
) {
  const controlsRef = useRef<React.ElementRef<typeof OrbitControls>>(null);
  const { camera, gl } = useThree();

  useImperativeHandle(
    ref,
    () => ({
      getSnapshot: (): CameraSnapshot => {
        const persp = camera as THREE.PerspectiveCamera;
        const controls = controlsRef.current;
        const canvas = gl.domElement;
        const aspect =
          canvas.clientHeight > 0 ? canvas.clientWidth / canvas.clientHeight : persp.aspect;
        return {
          position: [camera.position.x, camera.position.y, camera.position.z],
          target: controls
            ? [controls.target.x, controls.target.y, controls.target.z]
            : cameraState.target,
          fov: persp.isPerspectiveCamera ? persp.fov : 45,
          aspect,
        };
      },
    }),
    [camera, gl, cameraState.target]
  );

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
});

export default OrbitControlsWithCmdLock;
