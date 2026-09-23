/** Bounded posing for the shipped upright, unrigged figures. Mirror in sceneImporter.py. */
import type { BufferAttribute } from 'three';
import { refreshDeformableGeometry, type Deformable, type ShapeBounds } from './bodyShape';
import { torsoHalfWidth } from './bodyRegions';

export const BODY_POSE_KEYS = [
  'leftArmLift', 'rightArmLift', 'leftArmForward', 'rightArmForward',
  'leftElbow', 'rightElbow', 'leftLegSpread', 'rightLegSpread',
  'leftLegForward', 'rightLegForward', 'leftKnee', 'rightKnee', 'headTurn', 'headTilt',
] as const;
export type BodyPoseKey = (typeof BODY_POSE_KEYS)[number];
export type BodyPose = Record<BodyPoseKey, number>;
export const DEFAULT_BODY_POSE = Object.fromEntries(BODY_POSE_KEYS.map((key) => [key, 0])) as BodyPose;
export const BODY_POSE_BOUNDS: Record<BodyPoseKey, { min: number; max: number }> = {
  leftArmLift: { min: -10, max: 40 }, rightArmLift: { min: -10, max: 40 },
  leftArmForward: { min: -10, max: 35 }, rightArmForward: { min: -10, max: 35 },
  leftElbow: { min: 0, max: 85 }, rightElbow: { min: 0, max: 85 },
  leftLegSpread: { min: -5, max: 15 }, rightLegSpread: { min: -5, max: 15 },
  leftLegForward: { min: -15, max: 30 }, rightLegForward: { min: -15, max: 30 },
  leftKnee: { min: 0, max: 55 }, rightKnee: { min: 0, max: 55 },
  headTurn: { min: -35, max: 35 }, headTilt: { min: -15, max: 15 },
};
export const BODY_POSE_PARAMS: Array<{ key: BodyPoseKey; label: string; hint: string }> = [
  { key: 'leftArmLift', label: 'Left arm lift', hint: 'Lift the arm away from the body' },
  { key: 'rightArmLift', label: 'Right arm lift', hint: 'Lift the arm away from the body' },
  { key: 'leftArmForward', label: 'Left arm forward', hint: 'Move the arm forward or slightly back' },
  { key: 'rightArmForward', label: 'Right arm forward', hint: 'Move the arm forward or slightly back' },
  { key: 'leftElbow', label: 'Left elbow', hint: 'Bend the forearm forward; keeps the hand rigid' },
  { key: 'rightElbow', label: 'Right elbow', hint: 'Bend the forearm forward; keeps the hand rigid' },
  { key: 'leftLegSpread', label: 'Left leg spread', hint: 'Open the stance a little' },
  { key: 'rightLegSpread', label: 'Right leg spread', hint: 'Open the stance a little' },
  { key: 'leftLegForward', label: 'Left leg forward', hint: 'Bring the leg forward or slightly back' },
  { key: 'rightLegForward', label: 'Right leg forward', hint: 'Bring the leg forward or slightly back' },
  { key: 'leftKnee', label: 'Left knee', hint: 'Bend the knee backward; keeps the foot rigid' },
  { key: 'rightKnee', label: 'Right knee', hint: 'Bend the knee backward; keeps the foot rigid' },
  { key: 'headTurn', label: 'Head turn', hint: 'Turn right or left without changing the face' },
  { key: 'headTilt', label: 'Head tilt', hint: 'Gently tilt the head toward either shoulder' },
];
export interface BodyPosePreset { id: string; label: string; values: Partial<BodyPose> }
export const BODY_POSE_PRESETS: BodyPosePreset[] = [
  { id: 'neutral', label: 'Neutral', values: {} },
  { id: 'relaxed', label: 'Relaxed', values: { leftArmLift: -10, rightArmLift: -10, leftElbow: 8, rightElbow: 8 } },
  { id: 'arms_out', label: 'Arms out', values: { leftArmLift: 40, rightArmLift: 40, leftElbow: 5, rightElbow: 5 } },
  { id: 'arm_showcase', label: 'Arm showcase', values: { leftArmLift: 28, leftArmForward: 24, leftElbow: 35, rightArmLift: -8, headTurn: 12 } },
  { id: 'flex', label: 'Bent arms', values: { leftArmLift: 32, rightArmLift: 32, leftElbow: 70, rightElbow: 70 } },
  { id: 'step', label: 'Step', values: { leftLegForward: 16, leftKnee: 18, rightLegForward: -5, rightKnee: 5, leftArmForward: -8, rightArmForward: 14 } },
];

export function clampPoseValue(key: BodyPoseKey, value: number): number {
  const { min, max } = BODY_POSE_BOUNDS[key];
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : 0;
}
/** Keep a bent hand from folding back into the chest as the shoulder advances. */
export function poseBoundsForKey(key: BodyPoseKey, pose: Partial<BodyPose>): { min: number; max: number } {
  const bounds = BODY_POSE_BOUNDS[key];
  for (const side of ['left', 'right'] as const) {
    const elbow = `${side}Elbow` as const, forward = `${side}ArmForward` as const, lift = `${side}ArmLift` as const;
    if (key === elbow) {
      return { ...bounds, max: Math.min(bounds.max, 100 - Math.max(0, clampPoseValue(forward, pose[forward] ?? 0))) };
    }
    if (key === forward) {
      return { ...bounds, max: Math.min(bounds.max + Math.min(0, clampPoseValue(lift, pose[lift] ?? 0)),
        100 - clampPoseValue(elbow, pose[elbow] ?? 0)) };
    }
    if (key === lift) {
      return { ...bounds, min: Math.max(bounds.min, clampPoseValue(forward, pose[forward] ?? 0) - BODY_POSE_BOUNDS[forward].max) };
    }
  }
  return { ...bounds };
}
export function normalizePose(partial?: Partial<BodyPose> | null): BodyPose {
  const result = { ...DEFAULT_BODY_POSE };
  for (const key of BODY_POSE_KEYS) {
    const value = partial?.[key];
    if (typeof value === 'number') result[key] = clampPoseValue(key, value);
  }
  // A lowered shoulder has less forward room before its rear armpit folds.
  // Loading external data retains lift, then reduces forward motion and elbow;
  // the UI instead clamps the joint currently being edited.
  for (const side of ['left', 'right'] as const) {
    const lift = `${side}ArmLift` as const, forward = `${side}ArmForward` as const;
    result[forward] = Math.min(result[forward], BODY_POSE_BOUNDS[forward].max + Math.min(0, result[lift]));
  }
  for (const key of ['leftElbow', 'rightElbow'] as const) {
    result[key] = Math.min(result[key], poseBoundsForKey(key, result).max);
  }
  return result;
}
export function isDefaultPose(pose: BodyPose): boolean {
  return BODY_POSE_KEYS.every((key) => Math.abs(pose[key]) < 1e-8);
}
export function poseFromPreset(id: string): BodyPose {
  return normalizePose(BODY_POSE_PRESETS.find((preset) => preset.id === (id === 'arm_extended' ? 'arms_out' : id))?.values);
}

type Point3 = [number, number, number];
interface LimbJoints { shoulder: Point3; elbow: Point3; hip: Point3; knee: Point3 }
export interface PoseRig { left: LimbJoints; right: LimbJoints; head: Point3 }

function smoothstep(lo: number, hi: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** Joint selectors use the original figure; measured pivots follow its new shape. */
export function createPoseRig(deformables: Deformable[], bounds: ShapeBounds, original = false): PoseRig {
  const height = bounds.maxY - bounds.minY;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const halfWidth = Math.max(1e-6, (bounds.maxX - bounds.minX) / 2);
  const middleZ = (bounds.minZ + bounds.maxZ) / 2;
  function section(h: number, side: number, limb: 'arm' | 'leg' | 'head'): Point3 {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const d of deformables) {
      const shaped = d.geometry.getAttribute('position');
      for (const i of d.unique) {
        const offset = i * 3, x = d.base[offset], y = d.base[offset + 1];
        const originalH = (y - bounds.minY) / height;
        if (Math.abs(originalH - h) > 0.014) continue;
        if (side && (x - cx) * side <= 0) continue;
        const u = Math.abs(x - cx) / halfWidth;
        if (limb === 'arm' && u < torsoHalfWidth(originalH) - 0.025) continue;
        if (limb === 'leg' && (u > torsoHalfWidth(originalH) - 0.04 || Math.abs(x - cx) < height * 0.015)) continue;
        const position = original ? [d.base[offset], d.base[offset + 1], d.base[offset + 2]]
          : [shaped.getX(i), shaped.getY(i), shaped.getZ(i)];
        for (let axis = 0; axis < 3; axis++) {
          lo[axis] = Math.min(lo[axis], position[axis]); hi[axis] = Math.max(hi[axis], position[axis]);
        }
      }
    }
    return Number.isFinite(lo[0])
      ? [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2]
      : [cx + side * height * (limb === 'arm' ? 0.13 : 0.075), bounds.minY + height * h, middleZ];
  }
  const limb = (side: number): LimbJoints => ({
    shoulder: section(0.78, side, 'arm'), elbow: section(0.645, side, 'arm'),
    hip: section(0.49, side, 'leg'), knee: section(0.275, side, 'leg'),
  });
  return { left: limb(1), right: limb(-1), head: section(0.855, 0, 'head') };
}

interface PoseWeights {
  bounds: ShapeBounds;
  /** Per original vertex: arm, forearm, leg, calf, neck weights and side. */
  data: Float32Array;
}
const weightCache = new WeakMap<Deformable, PoseWeights>();
type ArmBoundary = Array<{ h: number; middle: number; halfGap: number }>;

/** The female inner arm sits inside the old male-only region guide. Measure
 * the empty torso/arm gap so every distal arm vertex receives one rotation. */
function measureArmBoundary(deformables: Deformable[], bounds: ShapeBounds): ArmBoundary {
  const height = bounds.maxY - bounds.minY, halfWidth = (bounds.maxX - bounds.minX) / 2;
  const cx = (bounds.minX + bounds.maxX) / 2;
  return [0.42, 0.46, 0.50, 0.54, 0.58, 0.62, 0.66, 0.70].map((h) => {
    const samples: number[] = [];
    for (const d of deformables) for (const i of d.unique) {
      if (Math.abs((d.base[i * 3 + 1] - bounds.minY) / height - h) < 0.012) {
        samples.push(Math.abs(d.base[i * 3] - cx));
      }
    }
    samples.sort((a, b) => a - b);
    let gap = 0, middle = torsoHalfWidth(h) * halfWidth;
    for (let i = 1; i < samples.length; i++) {
      const candidate = samples[i] - samples[i - 1], mid = (samples[i] + samples[i - 1]) / 2;
      if (mid < height * 0.06 || mid > height * 0.22) continue;
      if (candidate > gap) { gap = candidate; middle = mid; }
    }
    return gap > height * 0.008
      ? { h, middle: middle / halfWidth, halfGap: gap * 0.375 / halfWidth }
      : { h, middle: torsoHalfWidth(h), halfGap: 0.015 };
  });
}

function armBoundaryAt(boundary: ArmBoundary, h: number): { middle: number; halfGap: number } {
  if (h <= boundary[0].h) return boundary[0];
  for (let i = 1; i < boundary.length; i++) {
    if (h > boundary[i].h) continue;
    const a = boundary[i - 1], b = boundary[i], t = (h - a.h) / (b.h - a.h);
    return { middle: a.middle + (b.middle - a.middle) * t, halfGap: a.halfGap + (b.halfGap - a.halfGap) * t };
  }
  return boundary[boundary.length - 1];
}

function weightsFor(d: Deformable, bounds: ShapeBounds, originalRig: PoseRig | null, boundary: ArmBoundary | null): Float32Array {
  const previous = weightCache.get(d);
  if (previous?.bounds === bounds) return previous.data;
  const height = bounds.maxY - bounds.minY;
  const halfWidth = Math.max(1e-6, (bounds.maxX - bounds.minX) / 2), cx = (bounds.minX + bounds.maxX) / 2;
  const data = new Float32Array(d.base.length / 3 * 6);
  for (const i of d.unique) {
    const x = d.base[i * 3], h = (d.base[i * 3 + 1] - bounds.minY) / height;
    const u = Math.abs(x - cx) / halfWidth;
    const joints = x < cx ? originalRig!.right : originalRig!.left;
    const dx = joints.elbow[0] - joints.shoulder[0], dy = joints.elbow[1] - joints.shoulder[1], dz = joints.elbow[2] - joints.shoulder[2];
    const alongArm = ((x - joints.shoulder[0]) * dx + (d.base[i * 3 + 1] - joints.shoulder[1]) * dy +
      (d.base[i * 3 + 2] - joints.shoulder[2]) * dz) / (Math.hypot(dx, dy, dz) * height);
    // Below the armpit the torso/arm boundary runs through empty space. Keep
    // the distal limb rigid; feather motion along the shoulder, not its skin.
    const split = armBoundaryAt(boundary!, h), attachment = smoothstep(0.67, 0.79, h);
    const inner = split.halfGap + (0.08 - split.halfGap) * attachment;
    const outer = split.halfGap + (0.10 - split.halfGap) * attachment;
    const armRegion = smoothstep(split.middle - inner, split.middle + outer, u) *
      smoothstep(0.32, 0.40, h) * (1 - smoothstep(0.80, 0.875, h));
    const arm = armRegion * smoothstep(-0.015, 0.05, alongArm);
    const leg = (1 - armRegion) * (1 - smoothstep(0.43, 0.58, h)) * smoothstep(0, 0.025, Math.abs(x - cx) / height);
    data[i * 6] = arm;
    data[i * 6 + 1] = arm * (1 - smoothstep(0.605, 0.685, h));
    data[i * 6 + 2] = leg;
    data[i * 6 + 3] = leg * (1 - smoothstep(0.235, 0.315, h));
    data[i * 6 + 4] = smoothstep(0.83, 0.89, h);
    data[i * 6 + 5] = x < cx ? -1 : 1;
  }
  weightCache.set(d, { bounds, data });
  return data;
}

/** Rotate the point and accumulate the same rotation for its tangent frame. */
function rotate(point: Point3, quaternion: number[], pivot: Point3, axis: Point3, radians: number): void {
  if (Math.abs(radians) < 1e-12) return;
  const [ax, ay, az] = axis, half = radians / 2, sine = Math.sin(half);
  const qx = ax * sine, qy = ay * sine, qz = az * sine, qw = Math.cos(half);
  const x = point[0] - pivot[0], y = point[1] - pivot[1], z = point[2] - pivot[2];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  point[0] = pivot[0] + x + qw * tx + qy * tz - qz * ty;
  point[1] = pivot[1] + y + qw * ty + qz * tx - qx * tz;
  point[2] = pivot[2] + z + qw * tz + qx * ty - qy * tx;
  const [bx, by, bz, bw] = quaternion;
  quaternion[0] = qw * bx + qx * bw + qy * bz - qz * by;
  quaternion[1] = qw * by - qx * bz + qy * bw + qz * bx;
  quaternion[2] = qw * bz + qx * by - qy * bx + qz * bw;
  quaternion[3] = qw * bw - qx * bx - qy * by - qz * bz;
}

const X: Point3 = [1, 0, 0], Y: Point3 = [0, 1, 0], Z: Point3 = [0, 0, 1];

/**
 * Run AFTER applyBodyShape on every edit. The input is a freshly shaped cage,
 * never the result of a previous pose. Triangle order and every UV stay intact.
 * Actual partial-angle rotations avoid linear-blend shrinkage around hinges.
 */
export function applyBodyPose(deformables: Deformable[], bounds: ShapeBounds, partial: Partial<BodyPose>): void {
  const pose = normalizePose(partial);
  if (isDefaultPose(pose) || bounds.maxY <= bounds.minY || !deformables.length) return;
  const rig = createPoseRig(deformables, bounds), degrees = Math.PI / 180;
  const originalRig = deformables.some((d) => weightCache.get(d)?.bounds !== bounds)
    ? createPoseRig(deformables, bounds, true) : null;
  const armBoundary = originalRig ? measureArmBoundary(deformables, bounds) : null;
  const settings = [-1, 1].map((side) => {
    const prefix = side < 0 ? 'right' : 'left', joints = side < 0 ? rig.right : rig.left;
    const dx = joints.elbow[0] - joints.shoulder[0], dy = joints.elbow[1] - joints.shoulder[1];
    const length = Math.hypot(dx, dy);
    const elbowAxis: Point3 = length > 1e-8 ? [dy / length, -dx / length, 0] : [-1, 0, 0];
    return { joints, elbowAxis,
      lift: pose[`${prefix}ArmLift`] * degrees * side,
      forward: -pose[`${prefix}ArmForward`] * degrees,
      elbow: pose[`${prefix}Elbow`] * degrees,
      spread: pose[`${prefix}LegSpread`] * degrees * side,
      legForward: -pose[`${prefix}LegForward`] * degrees,
      knee: pose[`${prefix}Knee`] * degrees,
    };
  });
  for (const d of deformables) {
    const position = d.geometry.getAttribute('position') as BufferAttribute;
    const out = position.array as Float32Array, weights = weightsFor(d, bounds, originalRig, armBoundary);
    const tangent = d.geometry.getAttribute('tangent') as BufferAttribute | undefined;
    const rotations = tangent ? new Float32Array(position.count * 4) : null;
    for (const i of d.unique) {
      const w = i * 6, point: Point3 = [out[i * 3], out[i * 3 + 1], out[i * 3 + 2]], quaternion = [0, 0, 0, 1];
      const s = settings[weights[w + 5] < 0 ? 0 : 1];
      // Child first: parent rotations subsequently carry the entire bent limb.
      rotate(point, quaternion, s.joints.elbow, s.elbowAxis, s.elbow * weights[w + 1]);
      rotate(point, quaternion, s.joints.shoulder, X, s.forward * weights[w]);
      rotate(point, quaternion, s.joints.shoulder, Z, s.lift * weights[w]);
      rotate(point, quaternion, s.joints.knee, X, s.knee * weights[w + 3]);
      rotate(point, quaternion, s.joints.hip, X, s.legForward * weights[w + 2]);
      rotate(point, quaternion, s.joints.hip, Z, s.spread * weights[w + 2]);
      rotate(point, quaternion, rig.head, Y, pose.headTurn * degrees * weights[w + 4]);
      rotate(point, quaternion, rig.head, Z, -pose.headTilt * degrees * weights[w + 4]);
      out[i * 3] = point[0]; out[i * 3 + 1] = point[1]; out[i * 3 + 2] = point[2];
      if (rotations) rotations.set(quaternion, i * 4);
    }
    for (let i = 0; i < position.count; i++) {
      const source = d.source[i];
      if (source !== i) {
        out[i * 3] = out[source * 3]; out[i * 3 + 1] = out[source * 3 + 1]; out[i * 3 + 2] = out[source * 3 + 2];
      }
      // UV seam duplicates have DIFFERENT tangents despite identical positions.
      if (tangent && rotations) {
        const offset = source * 4, qx = rotations[offset], qy = rotations[offset + 1], qz = rotations[offset + 2], qw = rotations[offset + 3];
        const x = tangent.getX(i), y = tangent.getY(i), z = tangent.getZ(i);
        const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
        tangent.setXYZ(i, x + qw * tx + qy * tz - qz * ty, y + qw * ty + qz * tx - qx * tz, z + qw * tz + qx * ty - qy * tx);
      }
    }
    if (tangent) tangent.needsUpdate = true;
    refreshDeformableGeometry(d);
  }
}
