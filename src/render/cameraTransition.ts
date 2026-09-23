import { MathUtils, Spherical, Vector3 } from 'three';

export interface CameraView {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
}

export const CAMERA_TRANSITION_DURATION_MS = 560;

export interface CameraTransition {
  from: CameraView;
  to: CameraView;
  radiusFrom: number;
  radiusTo: number;
  yawFrom: number;
  yawDelta: number;
  polarFrom: number;
  polarTo: number;
}

const copyView = (view: CameraView): CameraView => ({
  position: [...view.position], target: [...view.target], fov: view.fov,
});

export function cameraViewsEqual(a: CameraView, b: CameraView, tolerance = 1e-7): boolean {
  return Math.abs(a.fov - b.fov) <= tolerance && a.position.every((value, i) => Math.abs(value - b.position[i]) <= tolerance) &&
    a.target.every((value, i) => Math.abs(value - b.target[i]) <= tolerance);
}

/** Orbit around a moving target, taking the shortest yaw rather than a chord
 * through the figure. The two endpoints are snapshots, never live references. */
export function createCameraTransition(from: CameraView, to: CameraView): CameraTransition {
  const a = new Spherical().setFromVector3(new Vector3(...from.position).sub(new Vector3(...from.target)));
  const b = new Spherical().setFromVector3(new Vector3(...to.position).sub(new Vector3(...to.target)));
  // A top/bottom view has no defined yaw. Borrow the other endpoint's yaw so
  // moving away from a pole does not introduce an arbitrary sideways sweep.
  if (Math.abs(Math.sin(a.phi)) < 1e-7) a.theta = b.theta;
  if (Math.abs(Math.sin(b.phi)) < 1e-7) b.theta = a.theta;
  const delta = MathUtils.euclideanModulo(b.theta - a.theta + Math.PI, Math.PI * 2) - Math.PI;
  return {
    from: copyView(from), to: copyView(to),
    radiusFrom: Math.max(1e-6, a.radius), radiusTo: Math.max(1e-6, b.radius),
    yawFrom: a.theta, yawDelta: delta, polarFrom: a.phi, polarTo: b.phi,
  };
}

/** Smoothstep has zero speed at both ends. Radius stays between its endpoints. */
export function sampleCameraTransition(transition: CameraTransition, progress: number): CameraView {
  const t = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  if (t === 0) return copyView(transition.from);
  if (t === 1) return copyView(transition.to);
  const eased = t * t * (3 - 2 * t);
  const target = new Vector3(...transition.from.target).lerp(new Vector3(...transition.to.target), eased);
  const offset = new Vector3().setFromSpherical(new Spherical(
    MathUtils.lerp(transition.radiusFrom, transition.radiusTo, eased),
    MathUtils.lerp(transition.polarFrom, transition.polarTo, eased),
    transition.yawFrom + transition.yawDelta * eased,
  ));
  return {
    position: offset.add(target).toArray() as [number, number, number],
    target: target.toArray() as [number, number, number],
    fov: MathUtils.lerp(transition.from.fov, transition.to.fov, eased),
  };
}
