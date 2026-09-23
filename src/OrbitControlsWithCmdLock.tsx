import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import {
  CAMERA_TRANSITION_DURATION_MS, cameraViewsEqual, createCameraTransition, sampleCameraTransition,
  type CameraTransition, type CameraView,
} from './render/cameraTransition';

export interface CameraSnapshot extends CameraView { aspect: number }
export interface OrbitControlsHandle { getSnapshot: () => CameraSnapshot; freezeSnapshot: (finishTransition?: boolean) => CameraSnapshot }

interface Props {
  enabled?: boolean;
  onOrbitStart?: () => void;
  cameraState: CameraView;
  /** Increment only for an external focus/view request, never for live feedback. */
  cameraRequestId?: number;
  setCameraState: (state: CameraView) => void;
}

interface ActiveTransition {
  path: CameraTransition;
  started: number;
  damping: boolean;
}

const OrbitControlsWithCmdLock = forwardRef<OrbitControlsHandle, Props>(function OrbitControlsWithCmdLock(
  { cameraState, cameraRequestId, setCameraState, onOrbitStart, enabled = true }, ref,
) {
  const controlsRef = useRef<React.ElementRef<typeof OrbitControls>>(null);
  const { camera, gl, scene, invalidate } = useThree();
  const transitionRef = useRef<ActiveTransition | null>(null);
  const applyingRef = useRef(false);
  const initializedRef = useRef(false);
  const requestRef = useRef<number | undefined>(undefined);
  const reportedRef = useRef<CameraView | null>(null);
  const reducedMotionRef = useRef(false);
  const callbacks = useRef({ setCameraState, onOrbitStart });
  callbacks.current = { setCameraState, onOrbitStart };

  const snapshot = useCallback((): CameraSnapshot => {
    const perspective = camera as THREE.PerspectiveCamera;
    const target = controlsRef.current?.target;
    return {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: target ? [target.x, target.y, target.z] : [0, 0, 0],
      fov: perspective.isPerspectiveCamera ? perspective.fov : 45,
      aspect: gl.domElement.clientHeight > 0
        ? gl.domElement.clientWidth / gl.domElement.clientHeight : perspective.aspect,
    };
  }, [camera, gl]);

  const report = useCallback(() => {
    const { position, target, fov } = snapshot();
    const view = { position, target, fov };
    reportedRef.current = view;
    callbacks.current.setCameraState(view);
  }, [snapshot]);

  const apply = useCallback((view: CameraView) => {
    const controls = controlsRef.current;
    applyingRef.current = true;
    try {
      camera.position.set(...view.position);
      const perspective = camera as THREE.PerspectiveCamera;
      if (perspective.isPerspectiveCamera && perspective.fov !== view.fov) {
        perspective.fov = view.fov;
        perspective.updateProjectionMatrix();
      }
      controls?.target.set(...view.target);
      controls?.update();
      camera.updateMatrixWorld();
      invalidate();
    } finally { applyingRef.current = false; }
  }, [camera, invalidate]);

  const stopTransition = useCallback((publish: boolean): boolean => {
    const active = transitionRef.current;
    if (!active) return false;
    transitionRef.current = null;
    if (controlsRef.current) controlsRef.current.enableDamping = active.damping;
    if (publish) report();
    return true;
  }, [report]);

  const freezeSnapshot = useCallback((finishTransition = false) => {
    if (finishTransition && transitionRef.current) apply(transitionRef.current.path.to);
    stopTransition(false);
    const view = snapshot();
    const controls = controlsRef.current;
    if (controls) {
      const damping = controls.enableDamping;
      controls.enableDamping = false;
      applyingRef.current = true;
      try { controls.update(); } finally { applyingRef.current = false; }
      apply(view);
      controls.enableDamping = damping;
    }
    report();
    return view;
  }, [stopTransition, snapshot, apply, report]);
  useImperativeHandle(ref, () => ({ getSnapshot: snapshot, freezeSnapshot }), [snapshot, freezeSnapshot]);
  useEffect(() => {
    // Placement may release its own temporary lock on window pointerup/blur.
    // Keep the external Snapshot lock separate so that release cannot override it.
    scene.userData.orbitInputEnabled = enabled;
    if (controlsRef.current) controlsRef.current.enabled = enabled;
    if (!enabled) freezeSnapshot();
  }, [enabled, freezeSnapshot, scene]);

  // ModelWithUVTattoo shares this instance to lock orbiting during placement.
  useEffect(() => {
    const sharedScene = scene as THREE.Scene & { orbitControls?: unknown };
    sharedScene.orbitControls = controlsRef.current;
    return () => { delete sharedScene.orbitControls; delete scene.userData.orbitInputEnabled; stopTransition(false); };
  }, [scene, stopTransition]);

  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const update = () => {
      reducedMotionRef.current = preference?.matches ?? false;
      const active = transitionRef.current;
      if (reducedMotionRef.current && active) {
        apply(active.path.to);
        stopTransition(true);
      }
    };
    update();
    preference?.addEventListener?.('change', update);
    return () => preference?.removeEventListener?.('change', update);
  }, [apply, stopTransition]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const onChange = () => {
      if (!applyingRef.current && !transitionRef.current) report();
    };
    const onStart = () => {
      stopTransition(true);
      callbacks.current.onOrbitStart?.();
    };
    // Capture interrupts before OrbitControls handles a gesture, including a
    // wheel or a Ctrl/Cmd tattoo placement that locks the orbit controls.
    const interrupt = () => {
      if (scene.userData.orbitInputEnabled === false) return;
      if (stopTransition(true)) callbacks.current.onOrbitStart?.();
    };
    const canvas = gl.domElement;
    const pointerStart = () => {
      controls.zoomSpeed = 0.35;
      interrupt();
    };
    const wheel = (event: WheelEvent) => {
      interrupt();
      // This OrbitControls version uses only the sign of deltaY. Set its step
      // before it handles the event so tiny trackpad deltas stay tiny.
      const unit = event?.deltaMode === 1 ? 16 : event?.deltaMode === 2 ? canvas.clientHeight : 1;
      const pixels = Math.abs(event?.deltaY ?? 0) * unit;
      controls.zoomSpeed = Number.isFinite(pixels) ? Math.min(0.4, pixels * 0.008) : 0;
    };
    controls.addEventListener('change', onChange);
    controls.addEventListener('start', onStart);
    canvas.addEventListener('pointerdown', pointerStart, true);
    canvas.addEventListener('wheel', wheel, { capture: true, passive: true });
    return () => {
      controls.removeEventListener('change', onChange);
      controls.removeEventListener('start', onStart);
      canvas.removeEventListener('pointerdown', pointerStart, true);
      canvas.removeEventListener('wheel', wheel, true);
    };
  }, [gl, scene, report, stopTransition]);

  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    const initial = !initializedRef.current;
    if (!initial && cameraRequestId !== undefined && cameraRequestId === requestRef.current) return;
    if (!initial && cameraRequestId === undefined && reportedRef.current && cameraViewsEqual(cameraState, reportedRef.current)) return;
    initializedRef.current = true;
    requestRef.current = cameraRequestId;
    stopTransition(false);
    const from = snapshot();
    const damping = controls.enableDamping;
    // Clear residual orbit inertia, then restore the exact starting snapshot.
    // Otherwise a previous drag adds another rotation to tween samples.
    controls.enableDamping = false;
    applyingRef.current = true;
    try { controls.update(); } finally { applyingRef.current = false; }
    if (initial || reducedMotionRef.current || cameraViewsEqual(from, cameraState)) {
      apply(cameraState);
      controls.enableDamping = damping;
      return;
    }
    apply(from);
    transitionRef.current = { path: createCameraTransition(from, cameraState), started: performance.now(), damping };
    invalidate();
  }, [cameraState, cameraRequestId, snapshot, apply, invalidate, stopTransition]);

  useFrame(() => {
    const active = transitionRef.current;
    if (!active) return;
    const progress = (performance.now() - active.started) / CAMERA_TRANSITION_DURATION_MS;
    apply(sampleCameraTransition(active.path, progress));
    if (progress >= 1) stopTransition(true);
  });

  useEffect(() => {
    let modifierLocked = false;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && controlsRef.current) {
        modifierLocked = true;
        controlsRef.current.enabled = false;
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey && controlsRef.current && modifierLocked) {
        modifierLocked = false;
        controlsRef.current.enabled = enabled;
      }
    };
    const onBlur = () => {
      if (modifierLocked && controlsRef.current) controlsRef.current.enabled = enabled;
      modifierLocked = false;
      stopTransition(true);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [stopTransition, enabled]);

  return <OrbitControls ref={controlsRef} enabled={enabled} zoomSpeed={0.35} />;
});

export default OrbitControlsWithCmdLock;
