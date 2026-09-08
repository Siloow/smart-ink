/**
 * Body regions on the full figure: what the user can isolate ("cut out") and
 * what the radial menu shapes.
 *
 * The mesh has no skeleton and no vertex groups, so regions come from the
 * figure's own silhouette: each vertex is classified from its normalised
 * height `h` (0 at the feet, 1 at the crown) and its signed lateral position
 * `u` (-1..1 across the full arm span). TORSO_HALF_WIDTH below was measured
 * off FinalBaseMesh.obj, which stands in an A-pose with the arms sweeping
 * from the shoulders (h 0.82) out to the fingertips (h 0.42, |u| 1.0).
 * Another figure would need it re-measured.
 *
 * The figure faces +Z with +Y up, so its own left is +X. (Verified from the
 * mesh: the toes reach +Z while the heels stop short of -Z.) Region names are
 * anatomical, so "Left arm" is on the viewer's right.
 *
 * smartink-live/sceneImporter.py mirrors this classification so a Blender
 * render can cut out the same region. Keep the constants in sync.
 */
import type { BodyShapeKey } from './bodyShape';

export type BodyRegionId = 'head' | 'torso' | 'armLeft' | 'armRight' | 'legLeft' | 'legRight';

/** Region ids as a float vertex attribute, so the shader can mask by region. */
export const REGION_BY_INDEX: BodyRegionId[] = [
  'torso',
  'head',
  'armLeft',
  'armRight',
  'legLeft',
  'legRight',
];

export const REGION_INDEX: Record<BodyRegionId, number> = {
  torso: 0,
  head: 1,
  armLeft: 2,
  armRight: 3,
  legLeft: 4,
  legRight: 5,
};

export interface BodyRegionDef {
  id: BodyRegionId;
  label: string;
  /** Shape controls the radial menu offers here, in wheel order. */
  params: BodyShapeKey[];
}

export const BODY_REGIONS: BodyRegionDef[] = [
  { id: 'head', label: 'Head', params: ['head', 'height', 'build'] },
  { id: 'torso', label: 'Torso', params: ['chest', 'waist', 'belly', 'hips', 'shoulders', 'build'] },
  { id: 'armLeft', label: 'Left arm', params: ['arms', 'shoulders', 'build'] },
  { id: 'armRight', label: 'Right arm', params: ['arms', 'shoulders', 'build'] },
  { id: 'legLeft', label: 'Left leg', params: ['legs', 'legLength', 'hips'] },
  { id: 'legRight', label: 'Right leg', params: ['legs', 'legLength', 'hips'] },
];

export function regionDef(id: BodyRegionId): BodyRegionDef {
  return BODY_REGIONS.find((r) => r.id === id) ?? BODY_REGIONS[1];
}

export function regionLabel(id: BodyRegionId | null): string {
  return id ? regionDef(id).label : 'Full figure';
}

/**
 * Slider groups in the inspector. `regions` is what lights up in the viewport
 * when the group is hovered; the thickness controls are symmetric, so an arm
 * group highlights both arms.
 */
export const SHAPE_PANEL_GROUPS: Array<{
  label: string;
  params: BodyShapeKey[];
  regions: BodyRegionId[];
}> = [
  { label: 'Whole figure', params: ['height', 'build'], regions: [] },
  { label: 'Head', params: ['head'], regions: ['head'] },
  { label: 'Torso', params: ['shoulders', 'chest', 'waist', 'belly', 'hips'], regions: ['torso'] },
  { label: 'Arms', params: ['arms'], regions: ['armLeft', 'armRight'] },
  { label: 'Legs', params: ['legs', 'legLength'], regions: ['legLeft', 'legRight'] },
];

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

/**
 * Half-width of the torso as a fraction of the half arm span, by height.
 *
 * Measured off body_male_realistic.glb by scanning 0.02-height bands and
 * taking the largest gap in the |u| distribution: between h 0.42 and 0.68 the
 * hanging arm is cleanly separated from the trunk, and each entry sits midway
 * across that gap. Above 0.68 the upper arm merges into the deltoid and there
 * is no gap to find, so the boundary is held at the value it reached there,
 * which keeps the deltoid on the arm side.
 */
const TORSO_HALF_WIDTH: Array<[number, number]> = [
  [0.0, 0.55],
  [0.4, 0.55],
  [0.42, 0.69],
  [0.46, 0.66],
  [0.5, 0.6],
  [0.54, 0.56],
  [0.58, 0.5],
  [0.62, 0.47],
  [0.66, 0.43],
  [0.68, 0.42],
  [0.82, 0.42],
  [0.87, 0.42],
  [1.0, 0.42],
];

/** Everything above this height is head and neck. */
const HEAD_FROM = 0.87;
/** Below this height, anything inside the torso silhouette is leg. */
const LEG_TO = 0.46;
/** Arms only exist between the fingertips and the shoulders. */
const ARM_FROM = 0.42;

export function torsoHalfWidth(h: number): number {
  const pts = TORSO_HALF_WIDTH;
  if (h <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (h <= pts[i][0]) {
      const [h0, w0] = pts[i - 1];
      const [h1, w1] = pts[i];
      const t = (h - h0) / (h1 - h0);
      return w0 + (w1 - w0) * t;
    }
  }
  return pts[pts.length - 1][1];
}

/**
 * @param h normalised height, 0 at the feet and 1 at the crown
 * @param u signed lateral position, -1..1, positive toward the figure's left
 */
export function classifyRegion(h: number, u: number): BodyRegionId {
  if (h >= HEAD_FROM) return 'head';
  const abs = Math.abs(u);
  if (h >= ARM_FROM && abs > torsoHalfWidth(h)) return u >= 0 ? 'armLeft' : 'armRight';
  if (h < LEG_TO) return u >= 0 ? 'legLeft' : 'legRight';
  return 'torso';
}

export interface RegionFrame {
  minY: number;
  height: number;
  centerX: number;
  halfWidth: number;
}

/** Normalisation frame for classification, from undeformed bounds. */
export function regionFrame(bounds: {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}): RegionFrame {
  return {
    minY: bounds.minY,
    height: Math.max(1e-6, bounds.maxY - bounds.minY),
    centerX: (bounds.minX + bounds.maxX) / 2,
    halfWidth: Math.max(1e-6, (bounds.maxX - bounds.minX) / 2),
  };
}

export function classifyPoint(x: number, y: number, frame: RegionFrame): BodyRegionId {
  return classifyRegion((y - frame.minY) / frame.height, (x - frame.centerX) / frame.halfWidth);
}
