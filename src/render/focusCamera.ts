import * as THREE from 'three';

export interface RegionFraming {
  center: [number, number, number];
  radius: number;
  /** Visible skin and cut-edge points in world space, after shaping and posing. */
  points?: Float32Array;
}

/** Focus keeps the side being viewed, while removing a steep viewing angle. */
export function levelFocusDirection(direction: [number, number, number]): [number, number, number] {
  const horizontal = new THREE.Vector3(direction[0], 0, direction[2]);
  if (!Number.isFinite(horizontal.lengthSq()) || horizontal.lengthSq() < 1e-6) horizontal.set(0, 0, 1);
  return horizontal.normalize().toArray() as [number, number, number];
}

/** Fit the visible surface against both camera axes, including its depth. */
export function fitRegionCamera(
  framing: RegionFraming,
  direction: [number, number, number],
  fov: number,
  aspect: number,
) {
  fov = Number.isFinite(fov) ? THREE.MathUtils.clamp(fov, 15, 90) : 45;
  aspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const vertical = THREE.MathUtils.degToRad(fov) / 2;
  const horizontal = Math.atan(Math.tan(vertical) * Math.max(0.1, aspect));
  const directionVector = new THREE.Vector3(...direction);
  if (!Number.isFinite(directionVector.lengthSq()) || directionVector.lengthSq() < 1e-8) directionVector.set(0, 0, 1);
  directionVector.normalize();
  // OrbitControls cannot sit exactly at a pole. Use the same stable convention
  // for fitting Top/Bottom so their final orientation matches the camera.
  if (Math.abs(directionVector.y) > 0.999999) {
    directionVector.z = 0.00001;
    directionVector.normalize();
  }
  const target = new THREE.Vector3(...framing.center);
  let distance = Math.max(0.001, framing.radius) / Math.sin(Math.min(vertical, horizontal)) * 1.15;
  const points = framing.points;
  if (points && points.length >= 3) {
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), directionVector).normalize();
    const up = new THREE.Vector3().crossVectors(directionVector, right).normalize();
    const offset = new THREE.Vector3();
    const min = new THREE.Vector3(Infinity, Infinity, Infinity), max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    for (let i = 0; i < points.length; i += 3) {
      offset.fromArray(points, i).sub(target);
      const projected = new THREE.Vector3(offset.dot(right), offset.dot(up), offset.dot(directionVector));
      min.min(projected); max.max(projected);
    }
    const middle = min.clone().add(max).multiplyScalar(0.5);
    target.addScaledVector(right, middle.x).addScaledVector(up, middle.y).addScaledVector(directionVector, middle.z);
    const tanH = Math.tan(horizontal), tanV = Math.tan(vertical);
    distance = 0.15;
    for (let i = 0; i < points.length; i += 3) {
      offset.fromArray(points, i).sub(target);
      const z = offset.dot(directionVector);
      distance = Math.max(distance, z + 0.15,
        z + Math.abs(offset.dot(right)) * 1.15 / tanH,
        z + Math.abs(offset.dot(up)) * 1.15 / tanV);
    }
  }
  return {
    position: directionVector.multiplyScalar(distance).add(target).toArray() as [number, number, number],
    target: target.toArray() as [number, number, number],
    fov,
  };
}
