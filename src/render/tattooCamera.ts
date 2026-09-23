import * as THREE from 'three';
import type { CameraView } from './cameraTransition';
import type { RegionFraming } from './focusCamera';
import { validateSurfaceAnchor, type SurfaceAnchor } from './surfacePlacement';

export interface TattooCameraAdjustment { azimuth: number; elevation: number; zoom: number }
export const DEFAULT_TATTOO_CAMERA_ADJUSTMENT: TattooCameraAdjustment = { azimuth: 0, elevation: 0, zoom: 1 };
export const TATTOO_CAMERA_LIMITS = {
  azimuth: { min: -55, max: 55 }, elevation: { min: -40, max: 40 }, zoom: { min: 0.65, max: 1.8 },
} as const;
export function normalizeTattooCamera(value?: Partial<TattooCameraAdjustment>): TattooCameraAdjustment {
  return Object.fromEntries(Object.entries(TATTOO_CAMERA_LIMITS).map(([name, bounds]) => {
    const key = name as keyof TattooCameraAdjustment, input = value?.[key];
    return [key, typeof input === 'number' && Number.isFinite(input)
      ? THREE.MathUtils.clamp(input, bounds.min, bounds.max) : DEFAULT_TATTOO_CAMERA_ADJUSTMENT[key]];
  })) as unknown as TattooCameraAdjustment;
}
export interface TattooFraming {
  /** Persistent tattoo anchor on the posed skin, in world space. Never recentered on its bounds. */
  center: [number, number, number];
  normal: [number, number, number];
  up: [number, number, number];
  radius: number;
  /** Exact clipped corners of the visible tattoo rectangle on the surface chart. */
  points: Float32Array;
  minDistance: number;
  /** Posed body triangles, used to keep the camera beyond skin along its sight line. */
  bodyTriangles?: Float32Array;
}
export interface TattooFootprint {
  size: number;
  aspect: number;
  rotationRad: number;
  /** Hair is drawn over skin; covered anchor/footprint regions cannot frame ink. */
  hairCoverage?: ArrayLike<number> | null;
}
interface Corner { point: THREE.Vector3; x: number; y: number; focus: number; uncovered: number; hair: number }
function clip(polygon: Corner[], field: (vertex: Corner) => number): Corner[] {
  const output: Corner[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length], fa = field(a), fb = field(b);
    if (fa >= 0) output.push(a);
    if ((fa >= 0) !== (fb >= 0)) {
      const t = fa / (fa - fb), lerp = (a: number, b: number) => a + (b - a) * t;
      output.push({ point: a.point.clone().lerp(b.point, t), x: lerp(a.x, b.x), y: lerp(a.y, b.y),
        focus: lerp(a.focus, b.focus), uncovered: lerp(a.uncovered, b.uncovered), hair: lerp(a.hair, b.hair) });
    }
  }
  return output;
}

/** Match the surface tattoo shader's rotated, aspect-correct rectangle, including
 * Focus/clothing clipping. Works with split UV seam vertices and posed positions. */
export function tattooFramingFromGeometry(
  geometry: THREE.BufferGeometry, matrixWorld: THREE.Matrix4, anchor: SurfaceAnchor, footprint: TattooFootprint,
): TattooFraming | null {
  const position = geometry.getAttribute('position'), uv = geometry.getAttribute('aTattooUv');
  const mask = geometry.getAttribute('aTattooMask'), normals = geometry.getAttribute('normal');
  if (!position || !uv || !mask || !validateSurfaceAnchor(anchor, geometry) ||
      uv.count !== position.count || mask.count !== position.count || !Number.isFinite(footprint.size) || footprint.size <= 0 ||
      !Number.isFinite(footprint.aspect) || footprint.aspect <= 0 || !Number.isFinite(footprint.rotationRad)) return null;
  const index = geometry.index, id = (corner: number) => index ? index.getX(corner) : corner;
  const anchorIds = [0, 1, 2].map(k => id(anchor.faceIndex * 3 + k));
  if (anchorIds.some(i => mask.getX(i) < .9999)) return null;
  const focus = geometry.getAttribute('aFocusMask'), clothing = geometry.getAttribute('aClothingMask');
  const fieldAtAnchor = (field: ArrayLike<number> | undefined | null, fallback: number) => field
    ? anchorIds.reduce((sum, i, k) => sum + field[i] * anchor.barycentric[k], 0) : fallback;
  if (fieldAtAnchor(focus?.array, 1) < 0 || fieldAtAnchor(clothing?.array, -1) >= 0 || fieldAtAnchor(footprint.hairCoverage, 0) >= .5) return null;
  const center = new THREE.Vector3(), normal = new THREE.Vector3(), point = new THREE.Vector3();
  anchorIds.forEach((i, k) => {
    center.addScaledVector(point.fromBufferAttribute(position, i), anchor.barycentric[k]);
    if (normals) normal.addScaledVector(point.fromBufferAttribute(normals, i), anchor.barycentric[k]);
  });
  center.applyMatrix4(matrixWorld);
  if (normal.lengthSq() < 1e-10) {
    const [a, b, c] = anchorIds.map(i => new THREE.Vector3().fromBufferAttribute(position, i));
    normal.crossVectors(b.sub(a), c.sub(a));
  }
  normal.applyMatrix3(new THREE.Matrix3().getNormalMatrix(matrixWorld)).normalize();
  if (normal.lengthSq() < .5 || !center.toArray().every(Number.isFinite)) return null;
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(normal, -normal.y);
  if (up.lengthSq() < 1e-6) up.set(0, 0, -1).addScaledVector(normal, normal.z);
  up.normalize();
  const c = Math.cos(footprint.rotationRad), s = Math.sin(footprint.rotationRad);
  const halfWidth = footprint.size * Math.min(footprint.aspect, 1) / 2;
  const halfHeight = footprint.size * Math.min(1 / footprint.aspect, 1) / 2;
  const output: number[] = [], body: number[] = [];
  const world = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) point.fromBufferAttribute(position, i).applyMatrix4(matrixWorld).toArray(world, i * 3);
  let radius = 0;
  for (let face = 0, count = index?.count ?? position.count; face < count; face += 3) {
    const ids = [id(face), id(face + 1), id(face + 2)];
    // Whole-body collision support is independent of ink/Focus visibility. A
    // hidden body part must not put the camera inside the full figure on exit.
    for (const i of ids) body.push(world[i * 3], world[i * 3 + 1], world[i * 3 + 2]);
    if (ids.some(i => mask.getX(i) < .9999)) continue;
    let polygon: Corner[] = ids.map(i => ({
      point: new THREE.Vector3().fromArray(world, i * 3), x: c * uv.getX(i) + s * uv.getY(i), y: -s * uv.getX(i) + c * uv.getY(i),
      focus: focus?.getX(i) ?? 1, uncovered: -(clothing?.getX(i) ?? -1), hair: .5 - (footprint.hairCoverage?.[i] ?? 0),
    }));
    for (const field of [(v: Corner) => halfWidth - v.x, (v: Corner) => halfWidth + v.x,
      (v: Corner) => halfHeight - v.y, (v: Corner) => halfHeight + v.y,
      (v: Corner) => v.focus, (v: Corner) => v.uncovered, (v: Corner) => v.hair]) {
      polygon = clip(polygon, field); if (!polygon.length) break;
    }
    for (const vertex of polygon) { output.push(...vertex.point.toArray()); radius = Math.max(radius, vertex.point.distanceTo(center)); }
  }
  if (output.length < 9 || radius < 1e-7) return null;
  return { center: center.toArray() as TattooFraming['center'], normal: normal.toArray() as TattooFraming['normal'],
    up: up.toArray() as TattooFraming['up'], radius, points: new Float32Array(output), minDistance: .18, bodyTriangles: new Float32Array(body) };
}

/** No placed/visible skin anchor: compose around the current visible figure. */
export function regionSnapshotFraming(region: RegionFraming, direction: [number, number, number]): TattooFraming {
  const normal = new THREE.Vector3(...direction);
  if (!Number.isFinite(normal.lengthSq()) || normal.lengthSq() < 1e-8) normal.set(0, 0, 1);
  normal.normalize();
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(normal, -normal.y);
  if (up.lengthSq() < 1e-6) up.set(0, 0, -1).addScaledVector(normal, normal.z);
  up.normalize();
  const radius = Number.isFinite(region.radius) ? Math.max(.001, region.radius) : 1;
  const points = region.points?.length ? region.points.slice() : new Float32Array([
    ...region.center.map((v, i) => v + (i === 0 ? radius : 0)), ...region.center.map((v, i) => v - (i === 0 ? radius : 0)),
    ...region.center.map((v, i) => v + (i === 1 ? radius : 0)), ...region.center.map((v, i) => v - (i === 1 ? radius : 0)),
    ...region.center.map((v, i) => v + (i === 2 ? radius : 0)), ...region.center.map((v, i) => v - (i === 2 ? radius : 0)),
  ]);
  return { center: [...region.center], normal: normal.toArray() as TattooFraming['normal'], up: up.toArray() as TattooFraming['up'],
    radius, points, minDistance: radius + .18 };
}

/** Fixed-target composition: angles stay in the skin's front hemisphere, while
 * zoom changes distance. Occluding body triangles impose a final safety stop. */
export function frameTattoo(framing: TattooFraming, value: Partial<TattooCameraAdjustment> = {}, aspect = 1): CameraView {
  const adjustment = normalizeTattooCamera(value), target = new THREE.Vector3(...framing.center);
  const normal = new THREE.Vector3(...framing.normal).normalize(), up = new THREE.Vector3(...framing.up).normalize();
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  const yaw = THREE.MathUtils.degToRad(adjustment.azimuth), elevation = THREE.MathUtils.degToRad(adjustment.elevation);
  const direction = normal.clone().multiplyScalar(Math.cos(yaw) * Math.cos(elevation))
    .addScaledVector(right, Math.sin(yaw) * Math.cos(elevation)).addScaledVector(up, Math.sin(elevation)).normalize();
  // Keep the world-up OrbitControls convention stable at the head/foot poles.
  if (Math.abs(direction.y) > .999999) direction.z += .001;
  direction.normalize();
  const cameraRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
  const cameraUp = new THREE.Vector3().crossVectors(direction, cameraRight).normalize();
  const fov = 38, tanV = Math.tan(THREE.MathUtils.degToRad(fov / 2));
  const tanH = tanV * (Number.isFinite(aspect) && aspect > 0 ? THREE.MathUtils.clamp(aspect, .1, 10) : 1);
  const offset = new THREE.Vector3();
  let fittedDistance = framing.minDistance, clearance = framing.minDistance;
  for (let i = 0; i < framing.points.length; i += 3) {
    offset.fromArray(framing.points, i).sub(target);
    const depth = offset.dot(direction);
    fittedDistance = Math.max(fittedDistance, depth + Math.max(Math.abs(offset.dot(cameraRight)) / tanH, Math.abs(offset.dot(cameraUp)) / tanV) * 1.2);
    clearance = Math.max(clearance, depth + .12);
  }
  const triangles = framing.bodyTriangles;
  if (triangles) {
    const ray = new THREE.Ray(target, direction), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), hit = new THREE.Vector3();
    for (let i = 0; i < triangles.length; i += 9) {
      if (ray.intersectTriangle(a.fromArray(triangles, i), b.fromArray(triangles, i + 3), c.fromArray(triangles, i + 6), false, hit)) {
        clearance = Math.max(clearance, hit.sub(target).dot(direction) + .18);
      }
    }
  }
  const distance = Math.max(clearance, fittedDistance / adjustment.zoom);
  return { position: target.clone().addScaledVector(direction, distance).toArray() as CameraView['position'], target: [...framing.center], fov };
}
