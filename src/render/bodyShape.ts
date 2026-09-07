/**
 * Sims-style body shaping without morph targets.
 *
 * None of the body meshes carry blend shapes, so shape sliders are applied
 * procedurally to the mesh's own vertices: inflate/deflate along welded
 * vertex normals inside smooth height bands (build, chest, waist, belly,
 * arms, legs), lateral scaling in bands (shoulders, hips), a head scale, a
 * leg stretch, and an overall height scale. Heights are fractions of the
 * undeformed bounding box so the same numbers work for every mesh.
 *
 * smartink-live/sceneImporter.py implements the identical math for Blender
 * (apply_body_shape). Keep the constants in BODY_SHAPE_TUNING in sync.
 */
import * as THREE from 'three';

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

export type BodyShapeGroup = 'Overall' | 'Torso' | 'Limbs' | 'Head';

export interface BodyShapeParam {
  key: BodyShapeKey;
  label: string;
  group: BodyShapeGroup;
  /** Height-band controls only make sense on a full figure. */
  figureOnly: boolean;
}

export const BODY_SHAPE_PARAMS: BodyShapeParam[] = [
  { key: 'height', label: 'Height', group: 'Overall', figureOnly: false },
  { key: 'build', label: 'Build', group: 'Overall', figureOnly: false },
  { key: 'shoulders', label: 'Shoulders', group: 'Torso', figureOnly: true },
  { key: 'chest', label: 'Chest', group: 'Torso', figureOnly: true },
  { key: 'waist', label: 'Waist', group: 'Torso', figureOnly: true },
  { key: 'belly', label: 'Belly', group: 'Torso', figureOnly: true },
  { key: 'hips', label: 'Hips', group: 'Torso', figureOnly: true },
  { key: 'arms', label: 'Arm thickness', group: 'Limbs', figureOnly: true },
  { key: 'legs', label: 'Leg thickness', group: 'Limbs', figureOnly: true },
  { key: 'legLength', label: 'Leg length', group: 'Limbs', figureOnly: true },
  { key: 'head', label: 'Head size', group: 'Head', figureOnly: true },
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

/** Whether a mesh is a full figure (bands apply) or a part (only global controls). */
export function isFigureBody(bodyMeshId: string): boolean {
  return bodyMeshId !== 'forearm';
}

export function bodyShapeParamsFor(bodyMeshId: string): BodyShapeParam[] {
  const figure = isFigureBody(bodyMeshId);
  return BODY_SHAPE_PARAMS.filter((p) => figure || !p.figureOnly);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Fills missing keys and clamps every value to [-1, 1]. */
export function normalizeShape(partial?: Partial<BodyShape> | null): BodyShape {
  const out: BodyShape = { ...DEFAULT_BODY_SHAPE };
  if (!partial) return out;
  for (const key of BODY_SHAPE_KEYS) {
    const v = partial[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = clamp(v, -1, 1);
  }
  return out;
}

/** The shape with controls that do not apply to this body zeroed out. */
export function effectiveShape(shape: BodyShape, bodyMeshId: string): BodyShape {
  const allowed = new Set(bodyShapeParamsFor(bodyMeshId).map((p) => p.key));
  const out: BodyShape = { ...DEFAULT_BODY_SHAPE };
  for (const key of BODY_SHAPE_KEYS) {
    if (allowed.has(key)) out[key] = shape[key];
  }
  return out;
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

/**
 * Amplitudes and band positions. Bands are centre/half-width as fractions of
 * body height (feet 0, crown 1); amplitudes are fractions of body height
 * (inflate) or scale factors at slider = 1. Mirrored in sceneImporter.py.
 */
export const BODY_SHAPE_TUNING = {
  height: 0.12,
  build: 0.03,
  shoulders: { scale: 0.14, c: 0.82, hw: 0.08 },
  chest: { amp: 0.03, c: 0.74, hw: 0.09 },
  waist: { amp: 0.035, c: 0.6, hw: 0.07 },
  belly: { amp: 0.055, c: 0.62, hw: 0.1 },
  hips: { scale: 0.1, c: 0.5, hw: 0.08 },
  arms: { amp: 0.025, c: 0.66, hw: 0.22 },
  legs: { amp: 0.03, c: 0.26, hw: 0.24 },
  legLength: { stretch: 0.12, hip: 0.5 },
  head: { scale: 0.18, c: 0.93, hw: 0.1 },
  /** Vertices further out laterally than this fraction of the half-width count as arms. */
  armMask: { from: 0.42, to: 0.62 },
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
  /** Welded normals of the undeformed mesh; the inflate direction. */
  normals: Float32Array;
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
  return { geometry, base, weld, weldCount, normals };
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

/**
 * Writes the reshaped positions and normals into each geometry. Y is up and
 * +Z faces the camera, matching the meshes in public/models/.
 */
export function applyBodyShape(
  deformables: Deformable[],
  bounds: ShapeBounds,
  shape: BodyShape,
  bodyMeshId: string
): void {
  const s = effectiveShape(shape, bodyMeshId);
  const T = BODY_SHAPE_TUNING;
  const H = bounds.maxY - bounds.minY;
  const halfW = Math.max(1e-6, (bounds.maxX - bounds.minX) / 2);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cz = (bounds.minZ + bounds.maxZ) / 2;
  const hipY = bounds.minY + T.legLength.hip * H;
  const headY = bounds.minY + T.head.c * H;
  const identity = isDefaultShape(s) || H <= 0;

  const amp = {
    build: T.build * H,
    chest: T.chest.amp * H,
    waist: T.waist.amp * H,
    belly: T.belly.amp * H,
    arms: T.arms.amp * H,
    legs: T.legs.amp * H,
  };
  const heightK = 1 + T.height * s.height;
  const legK = 1 + T.legLength.stretch * s.legLength;

  for (const d of deformables) {
    const attr = d.geometry.getAttribute('position') as THREE.BufferAttribute;
    const out = attr.array as Float32Array;
    const base = d.base;
    const n = d.normals;
    const count = attr.count;

    if (identity) {
      out.set(base);
    } else {
      for (let i = 0; i < count; i++) {
        const o = i * 3;
        const x0 = base[o], y0 = base[o + 1], z0 = base[o + 2];
        const nx = n[o], ny = n[o + 1], nz = n[o + 2];
        const h = (y0 - bounds.minY) / H;
        const u = Math.abs(x0 - cx) / halfW;
        const front = Math.max(0, nz);
        const armMask = smoothstep(T.armMask.from, T.armMask.to, u);
        const torsoMask = 1 - armMask;

        const off =
          s.build * amp.build +
          s.chest * amp.chest * band(h, T.chest.c, T.chest.hw) * torsoMask +
          s.waist * amp.waist * band(h, T.waist.c, T.waist.hw) * torsoMask +
          s.belly * amp.belly * band(h, T.belly.c, T.belly.hw) * torsoMask * front +
          s.arms * amp.arms * band(h, T.arms.c, T.arms.hw) * armMask +
          s.legs * amp.legs * band(h, T.legs.c, T.legs.hw) * torsoMask;

        let x = x0 + nx * off;
        let y = y0 + ny * off;
        let z = z0 + nz * off;

        const lateral =
          (1 + T.shoulders.scale * s.shoulders * band(h, T.shoulders.c, T.shoulders.hw)) *
          (1 + T.hips.scale * s.hips * band(h, T.hips.c, T.hips.hw));
        x = cx + (x - cx) * lateral;

        if (s.head !== 0) {
          const k = 1 + T.head.scale * s.head * band(h, T.head.c, T.head.hw);
          x = cx + (x - cx) * k;
          y = headY + (y - headY) * k;
          z = cz + (z - cz) * k;
        }

        if (y < hipY) y = hipY - (hipY - y) * legK;

        out[o] = cx + (x - cx) * heightK;
        out[o + 1] = bounds.minY + (y - bounds.minY) * heightK;
        out[o + 2] = cz + (z - cz) * heightK;
      }
    }

    attr.needsUpdate = true;
    const normalAttr = d.geometry.getAttribute('normal') as THREE.BufferAttribute | undefined;
    if (normalAttr && normalAttr.array.length === out.length) {
      computeWeldedNormals(
        out,
        count,
        d.geometry.index ? d.geometry.index.array : null,
        d.weld,
        d.weldCount,
        normalAttr.array as Float32Array
      );
      normalAttr.needsUpdate = true;
    }
    d.geometry.computeBoundingBox();
    d.geometry.computeBoundingSphere();
  }
}
