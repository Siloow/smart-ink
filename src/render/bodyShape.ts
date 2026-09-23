/** Bounded, proportional body shaping. Keep sceneImporter.py in sync. */
import * as THREE from 'three';
import { torsoHalfWidth } from './bodyRegions';

export const BODY_SHAPE_KEYS = [
  'height',
  'build',
  'shoulders',
  'chest',
  'waist',
  'belly',
  'hips',
  'arms',
  'legs',
  'legLength',
  'head',
] as const;

export type BodyShapeKey = (typeof BODY_SHAPE_KEYS)[number];
export type BodyShape = Record<BodyShapeKey, number>;

export const DEFAULT_BODY_SHAPE: BodyShape = {
  height: 0,
  build: 0,
  shoulders: 0,
  chest: 0,
  waist: 0,
  belly: 0,
  hips: 0,
  arms: 0,
  legs: 0,
  legLength: 0,
  head: 0,
};

/** Slider strength is normalized; physical limits live in BODY_SHAPE_TUNING. */
export const BODY_SHAPE_LIMITS: Record<BodyShapeKey, { min: number; max: number }> =
  Object.fromEntries(BODY_SHAPE_KEYS.map((key) => [key, { min: -1, max: 1 }])) as Record<BodyShapeKey, { min: number; max: number }>;

export function clampShapeValue(key: BodyShapeKey, value: number): number {
  const { min, max } = BODY_SHAPE_LIMITS[key];
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;
}

export interface BodyShapeParam {
  key: BodyShapeKey;
  label: string;
  /** Shown under the slider; says what the control actually moves. */
  hint: string;
}

export const BODY_SHAPE_PARAMS: BodyShapeParam[] = [
  { key: 'height', label: 'Height', hint: 'Whole figure, from 8% shorter to 8% taller' },
  { key: 'build', label: 'Build', hint: 'Body fullness; preserves the face, hands and feet' },
  { key: 'shoulders', label: 'Shoulders', hint: 'Moves shoulders and arms together' },
  { key: 'chest', label: 'Chest', hint: 'Proportional rib-cage width and depth' },
  { key: 'waist', label: 'Waist', hint: 'Smoothly adjusts the middle of the torso' },
  { key: 'belly', label: 'Belly', hint: 'Front fullness with a gradual blend into the ribs' },
  { key: 'hips', label: 'Hips', hint: 'Pelvis width, blending into the upper legs' },
  { key: 'arms', label: 'Arms', hint: 'Upper arms and forearms; preserves hands and softens at elbows' },
  { key: 'legs', label: 'Legs', hint: 'Thighs and calves; preserves feet and softens at knees' },
  { key: 'legLength', label: 'Leg length', hint: 'Lengthens the legs while keeping feet grounded' },
  { key: 'head', label: 'Head', hint: 'Up to 6% smaller or larger; preserves facial proportions' },
];

export interface BodyShapePreset {
  id: string;
  label: string;
  values: Partial<BodyShape>;
}

export const BODY_SHAPE_PRESETS: BodyShapePreset[] = [
  { id: 'default', label: 'Default', values: {} },
  { id: 'slim', label: 'Slim', values: { build: -0.6, waist: -0.5, belly: -0.4, arms: -0.3, legs: -0.3 } },
  { id: 'athletic', label: 'Athletic', values: { shoulders: 0.5, chest: 0.4, waist: -0.3, arms: 0.4, legs: 0.3 } },
  { id: 'heavy', label: 'Heavy', values: { build: 0.7, belly: 0.8, waist: 0.6, hips: 0.4, arms: 0.4, legs: 0.4 } },
  { id: 'tall', label: 'Tall', values: { height: 0.8, legLength: 0.5 } },
  { id: 'petite', label: 'Petite', values: { height: -0.7, legLength: -0.3, head: 0.15 } },
];

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Fills missing keys and clamps every value to [-1, 1]. */
export function normalizeShape(partial?: Partial<BodyShape> | null): BodyShape {
  const out: BodyShape = { ...DEFAULT_BODY_SHAPE };
  if (!partial) return out;
  for (const key of BODY_SHAPE_KEYS) {
    const v = partial[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = clampShapeValue(key, v);
  }
  return out;
}

/** Clamped copy, with every key present. */
export function effectiveShape(shape: BodyShape): BodyShape {
  return normalizeShape(shape);
}

export function isDefaultShape(shape: BodyShape): boolean {
  return BODY_SHAPE_KEYS.every((k) => Math.abs(shape[k]) < 1e-4);
}

export function shapeFromPreset(preset: BodyShapePreset): BodyShape {
  return normalizeShape(preset.values);
}

export function isPresetActive(shape: BodyShape, preset: BodyShapePreset): boolean {
  const target = shapeFromPreset(preset);
  return BODY_SHAPE_KEYS.every((k) => Math.abs(shape[k] - target[k]) < 1e-3);
}

export function formatShapeValue(v: number): string {
  const pct = Math.round(v * 100);
  return pct === 0 ? '0' : `${pct > 0 ? '+' : ''}${pct}`;
}

// ---------------------------------------------------------------------------
// Deformation
// ---------------------------------------------------------------------------

/** Combined regional limits prevent Build + a local control from over-inflating. */
export const BODY_SHAPE_TUNING = {
  height: 0.08,
  build: 0.14,
  shoulders: 0.012,
  chest: { width: 0.10, depth: 0.14, c: 0.735, hw: 0.13 },
  waist: { scale: 0.16, c: 0.605, hw: 0.12 },
  belly: { depth: 0.022, c: 0.59, hw: 0.13 },
  hips: 0.009,
  arms: { scale: 0.27, min: 0.78, max: 1.32 },
  legs: { scale: 0.25, min: 0.80, max: 1.30 },
  torso: { min: 0.80, max: 1.28 },
  legLength: 0.035,
  head: { scale: 0.06, pivot: 0.855 },
} as const;

/** Raised-cosine window: 1 at the centre, 0 beyond ±hw. */
function band(h: number, c: number, hw: number): number {
  const t = Math.min(1, Math.abs(h - c) / hw);
  return 0.5 * (1 + Math.cos(Math.PI * t));
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export interface Deformable {
  geometry: THREE.BufferGeometry;
  /** Undeformed positions, the input to every application. */
  base: Float32Array;
  /** Welded (position-shared) vertex index, for smooth normals across seams. */
  weld: Int32Array;
  weldCount: number;
  /** Exact position representatives: deform seam/face duplicates only once. */
  unique: Uint32Array;
  source: Uint32Array;
  /** Welded normals of the undeformed mesh, retained for placement consumers. */
  normals: Float32Array;
  /** Original UV tangent frame; pose edits reset and rotate these directions. */
  tangents?: Float32Array;
}

export interface ShapeBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

function buildWeld(pos: Float32Array, count: number): { weld: Int32Array; weldCount: number } {
  const weld = new Int32Array(count);
  const map = new Map<string, number>();
  let next = 0;
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(pos[i * 3] * 1e4)},${Math.round(pos[i * 3 + 1] * 1e4)},${Math.round(pos[i * 3 + 2] * 1e4)}`;
    let id = map.get(key);
    if (id === undefined) {
      id = next++;
      map.set(key, id);
    }
    weld[i] = id;
  }
  return { weld, weldCount: next };
}

/** Area-weighted normals accumulated per welded vertex, written per vertex. */
function computeWeldedNormals(
  pos: Float32Array,
  count: number,
  index: ArrayLike<number> | null,
  weld: Int32Array,
  weldCount: number,
  out: Float32Array
): void {
  const acc = new Float32Array(weldCount * 3);
  const triCount = index ? Math.floor(index.length / 3) : Math.floor(count / 3);
  for (let t = 0; t < triCount; t++) {
    const a = index ? index[t * 3] : t * 3;
    const b = index ? index[t * 3 + 1] : t * 3 + 1;
    const c = index ? index[t * 3 + 2] : t * 3 + 2;
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const e1x = pos[b * 3] - ax, e1y = pos[b * 3 + 1] - ay, e1z = pos[b * 3 + 2] - az;
    const e2x = pos[c * 3] - ax, e2y = pos[c * 3 + 1] - ay, e2z = pos[c * 3 + 2] - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const v of [a, b, c]) {
      const w = weld[v] * 3;
      acc[w] += nx;
      acc[w + 1] += ny;
      acc[w + 2] += nz;
    }
  }
  for (let i = 0; i < count; i++) {
    const w = weld[i] * 3;
    const nx = acc[w], ny = acc[w + 1], nz = acc[w + 2];
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) {
      out[i * 3] = nx / len;
      out[i * 3 + 1] = ny / len;
      out[i * 3 + 2] = nz / len;
    } else {
      out[i * 3] = 0;
      out[i * 3 + 1] = 1;
      out[i * 3 + 2] = 0;
    }
  }
}

/** Snapshot a geometry (already cloned by the caller) so it can be reshaped repeatedly. */
export function prepareDeformable(geometry: THREE.BufferGeometry): Deformable {
  const attr = geometry.getAttribute('position') as THREE.BufferAttribute;
  const base = new Float32Array(attr.array as ArrayLike<number>);
  const count = attr.count;
  const { weld, weldCount } = buildWeld(base, count);
  const normals = new Float32Array(count * 3);
  computeWeldedNormals(base, count, geometry.index ? geometry.index.array : null, weld, weldCount, normals);
  const representatives = new Map<string, number>();
  const source = new Uint32Array(count), unique: number[] = [];
  for (let i = 0; i < count; i++) {
    const key = `${base[i * 3]},${base[i * 3 + 1]},${base[i * 3 + 2]}`;
    let first = representatives.get(key);
    if (first === undefined) { first = i; representatives.set(key, i); unique.push(i); }
    source[i] = first;
  }
  const tangent = geometry.getAttribute('tangent');
  const tangents = tangent ? new Float32Array(tangent.array) : undefined;
  return { geometry, base, weld, weldCount, normals, tangents, source, unique: Uint32Array.from(unique) };
}

/** Union bounds of the undeformed meshes, in their shared local space. */
export function shapeBounds(deformables: Deformable[]): ShapeBounds {
  const b: ShapeBounds = {
    minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity,
  };
  for (const d of deformables) {
    const p = d.base;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i] < b.minX) b.minX = p[i];
      if (p[i] > b.maxX) b.maxX = p[i];
      if (p[i + 1] < b.minY) b.minY = p[i + 1];
      if (p[i + 1] > b.maxY) b.maxY = p[i + 1];
      if (p[i + 2] < b.minZ) b.minZ = p[i + 2];
      if (p[i + 2] > b.maxZ) b.maxZ = p[i + 2];
    }
  }
  return b;
}

type Point3 = [number, number, number];
interface ShapeFrame {
  arms: [Point3, Point3][];
  legs: [Point3, Point3][];
  torsoZ: number;
  headZ: number;
}

/** Measure centerlines from the ORIGINAL mesh, so male/female proportions are retained. */
function measureFrame(deformables: Deformable[], bounds: ShapeBounds): ShapeFrame {
  const H = bounds.maxY - bounds.minY;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const halfW = (bounds.maxX - bounds.minX) / 2;
  function section(h: number, side: number, limb: boolean): Point3 {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const d of deformables) for (const vertex of d.unique) {
      const i = vertex * 3;
      const x = d.base[i], y = d.base[i + 1], z = d.base[i + 2];
      if (Math.abs((y - bounds.minY) / H - h) > 0.018) continue;
      if (side && (x - cx) * side <= 0) continue;
      const outside = Math.abs(x - cx) / halfW > torsoHalfWidth(h);
      if (h > 0.5 && outside !== limb) continue;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    }
    return [Number.isFinite(minX) ? (minX + maxX) / 2 : cx + side * H * 0.1,
      bounds.minY + h * H,
      Number.isFinite(minZ) ? (minZ + maxZ) / 2 : (bounds.minZ + bounds.maxZ) / 2];
  }
  return {
    arms: [-1, 1].map((side) => [section(0.54, side, true), section(0.76, side, true)]),
    legs: [-1, 1].map((side) => [section(0.12, side, false), section(0.42, side, false)]),
    torsoZ: section(0.60, 0, false)[2],
    headZ: section(0.90, 0, false)[2],
  };
}

/** Change radius perpendicular to the limb, not its length or small skin details. */
function radialDelta(p: Point3, axis: [Point3, Point3], amount: number): Point3 {
  const [a, b] = axis;
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy + (p[2] - a[2]) * dz) /
    Math.max(1e-12, dx * dx + dy * dy + dz * dz);
  return [(p[0] - a[0] - t * dx) * amount,
    (p[1] - a[1] - t * dy) * amount, (p[2] - a[2] - t * dz) * amount];
}

/** Writes positions from the original snapshot; edits never accumulate. */
export function applyBodyShape(deformables: Deformable[], bounds: ShapeBounds, shape: BodyShape): void {
  const s = effectiveShape(shape), T = BODY_SHAPE_TUNING;
  const H = bounds.maxY - bounds.minY;
  const halfW = Math.max(1e-6, (bounds.maxX - bounds.minX) / 2);
  const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
  const identity = isDefaultShape(s) || H <= 0;
  const frame = identity ? null : measureFrame(deformables, bounds);
  const heightK = 1 + T.height * s.height;
  const armAmount = clamp(1 + T.arms.scale * s.arms + 0.12 * s.build, T.arms.min, T.arms.max) - 1;
  const legAmount = clamp(1 + T.legs.scale * s.legs + 0.12 * s.build, T.legs.min, T.legs.max) - 1;

  for (const d of deformables) {
    const attr = d.geometry.getAttribute('position') as THREE.BufferAttribute;
    const out = attr.array as Float32Array, base = d.base, count = attr.count;
    if (!frame) out.set(base);
    else for (const i of d.unique) {
      const o = i * 3;
      const x0 = base[o], y0 = base[o + 1], z0 = base[o + 2];
      const h = (y0 - bounds.minY) / H, u = Math.abs(x0 - cx) / halfW;
      const sign = x0 < cx ? -1 : 1, side = sign < 0 ? 0 : 1;
      const armMask = smoothstep(torsoHalfWidth(h) - 0.035, torsoHalfWidth(h) + 0.065, u) *
        smoothstep(0.32, 0.40, h) * (1 - smoothstep(0.82, 0.88, h));
      const torsoEnvelope = smoothstep(0.43, 0.52, h) * (1 - smoothstep(0.79, 0.87, h));
      const torsoMask = (1 - armMask) * torsoEnvelope;
      const chest = band(h, T.chest.c, T.chest.hw), waist = band(h, T.waist.c, T.waist.hw);
      const width = clamp(1 + T.build * s.build + T.chest.width * s.chest * chest +
        T.waist.scale * s.waist * waist, T.torso.min, T.torso.max) - 1;
      const depth = clamp(1 + T.build * s.build + T.chest.depth * s.chest * chest +
        T.waist.scale * s.waist * waist, T.torso.min, T.torso.max) - 1;
      // Preserve continuity at the deltoid: a wider chest carries the whole arm.
      const carryWidth = clamp(1 + T.build * s.build + T.chest.width * s.chest,
        T.torso.min, T.torso.max) - 1;
      let x = x0 + (x0 - cx) * width * torsoMask + sign * H * 0.105 * carryWidth * armMask;
      let y = y0;
      let z = z0 + (z0 - frame.torsoZ) * depth * torsoMask;
      z += H * T.belly.depth * s.belly * band(h, T.belly.c, T.belly.hw) * torsoMask *
        smoothstep(-0.01, 0.045, (z0 - frame.torsoZ) / H);

      const armWeight = armMask * smoothstep(0.51, 0.57, h) * (1 - smoothstep(0.77, 0.85, h)) *
        (1 - 0.25 * band(h, 0.64, 0.04));
      const legWeight = (1 - armMask) * smoothstep(0.075, 0.17, h) * (1 - smoothstep(0.40, 0.51, h)) *
        (1 - 0.55 * band(h, 0.275, 0.055)) * smoothstep(0, 0.035, Math.abs(x0 - cx) / H);
      const da = radialDelta([x0, y0, z0], frame.arms[side], armAmount * armWeight);
      const dl = radialDelta([x0, y0, z0], frame.legs[side], legAmount * legWeight);
      x += da[0] + dl[0]; y += da[1] + dl[1]; z += da[2] + dl[2];

      // Carry attached arms with the shoulder; do not stretch the hand itself.
      const shoulderWeight = armMask + (1 - armMask) * smoothstep(0.65, 0.78, h) *
        (1 - smoothstep(0.82, 0.89, h)) * smoothstep(0, 0.09, Math.abs(x0 - cx) / H);
      x += sign * H * T.shoulders * s.shoulders * shoulderWeight;
      const hipWeight = (1 - armMask) * smoothstep(0.20, 0.47, h) * (1 - smoothstep(0.54, 0.64, h)) *
        smoothstep(0, 0.065, Math.abs(x0 - cx) / H);
      x += sign * H * T.hips * s.hips * hipWeight;

      // Uniform face scaling with a neck transition, instead of a face-shaped bulge.
      const headK = T.head.scale * s.head * smoothstep(0.83, 0.90, h);
      x += (x0 - cx) * headK;
      y += (y0 - (bounds.minY + T.head.pivot * H)) * headK;
      z += (z0 - frame.headZ) * headK;
      // Length is added above the feet; the upper body moves as one piece.
      y += T.legLength * H * s.legLength * (armMask + (1 - armMask) * smoothstep(0.045, 0.48, h));
      out[o] = cx + (x - cx) * heightK;
      out[o + 1] = bounds.minY + (y - bounds.minY) * heightK;
      out[o + 2] = cz + (z - cz) * heightK;
    }
    if (frame) for (let i = 0; i < count; i++) {
      const source = d.source[i];
      if (source === i) continue;
      out[i * 3] = out[source * 3];
      out[i * 3 + 1] = out[source * 3 + 1];
      out[i * 3 + 2] = out[source * 3 + 2];
    }
    const tangent = d.geometry.getAttribute('tangent');
    if (tangent && d.tangents) {
      (tangent.array as Float32Array).set(d.tangents);
      tangent.needsUpdate = true;
    }
    refreshDeformableGeometry(d);
  }
}

/** Refresh lighting normals and picking bounds after shape or pose deformation. */
export function refreshDeformableGeometry(d: Deformable): void {
  const attr = d.geometry.getAttribute('position') as THREE.BufferAttribute;
  const out = attr.array as Float32Array;
  attr.needsUpdate = true;
  const normalAttr = d.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
  if (normalAttr && normalAttr.array.length === out.length) {
    computeWeldedNormals(out, attr.count, d.geometry.index ? d.geometry.index.array : null,
      d.weld, d.weldCount, normalAttr.array as Float32Array);
    normalAttr.needsUpdate = true;
  }
  d.geometry.computeBoundingBox();
  d.geometry.computeBoundingSphere();
}
