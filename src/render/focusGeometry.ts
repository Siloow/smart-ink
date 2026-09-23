import * as THREE from 'three';
import type { RegionFraming } from './focusCamera';

/** Include clipped edges as well as kept vertices, matching the shader cutoff. */
export function visibleRegionPoints(geometry: THREE.BufferGeometry, worldMatrix: THREE.Matrix4, field?: ArrayLike<number>): Float32Array {
  const position = geometry.getAttribute('position');
  const output: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  const append = (point: THREE.Vector3) => {
    point.applyMatrix4(worldMatrix);
    output.push(point.x, point.y, point.z);
  };
  for (let i = 0; i < position.count; i++) {
    if (!field || field[i] >= 0) append(a.fromBufferAttribute(position, i));
  }
  if (field) {
    const index = geometry.index;
    const count = index ? index.count : position.count;
    for (let f = 0; f < count; f += 3) {
      for (let edge = 0; edge < 3; edge++) {
        const i = index ? index.getX(f + edge) : f + edge;
        const j = index ? index.getX(f + (edge + 1) % 3) : f + (edge + 1) % 3;
        const fa = field[i], fb = field[j];
        if ((fa >= 0) === (fb >= 0)) continue;
        a.fromBufferAttribute(position, i); b.fromBufferAttribute(position, j);
        append(a.lerp(b, fa / (fa - fb)));
      }
    }
  }
  return new Float32Array(output);
}

export function framingFromPoints(points: Float32Array): RegionFraming | null {
  if (!points.length) return null;
  const box = new THREE.Box3(), point = new THREE.Vector3();
  for (let i = 0; i < points.length; i += 3) box.expandByPoint(point.fromArray(points, i));
  return {
    center: box.getCenter(point).toArray() as [number, number, number],
    radius: Math.max(0.001, box.getSize(point).length() / 2),
    points,
  };
}

/** Categorical voting cannot invent a third body part between two labels. */
export function regionAtTriangle(labels: number[], barycentric: THREE.Vector3): number {
  const votes = new Map<number, number>();
  for (let i = 0; i < 3; i++) votes.set(labels[i], (votes.get(labels[i]) ?? 0) + barycentric.getComponent(i));
  let selected = labels[0], best = -Infinity;
  for (const [region, weight] of votes) if (weight > best) { selected = region; best = weight; }
  return selected;
}
