import { regionFrame, torsoHalfWidth, type BodyRegionId } from './bodyRegions';

type RegionBounds = { minX: number; maxX: number; minY: number; maxY: number };
export type BodyRegionMasks = Record<BodyRegionId, Float32Array>;
type ArmBoundary = Array<{ h: number; width: number }>;

/** Measure the empty space between torso and arms on the undeformed model.
 * The female forearm sits inside the old male-only silhouette guide. Above
 * the armpit the final sample continues as a smooth shoulder cut. */
function measureArmBoundary(base: ArrayLike<number>, bounds: RegionBounds): ArmBoundary {
  const { minY, height, centerX, halfWidth } = regionFrame(bounds);
  return [0.42, 0.46, 0.50, 0.54, 0.58, 0.62, 0.66, 0.70].map((h) => {
    const samples: number[] = [];
    for (let i = 0; i < base.length; i += 3) {
      if (Math.abs((base[i + 1] - minY) / height - h) < 0.012) samples.push(Math.abs(base[i] - centerX));
    }
    samples.sort((a, b) => a - b);
    let gap = 0, middle = torsoHalfWidth(h) * halfWidth;
    for (let i = 1; i < samples.length; i++) {
      const candidate = samples[i] - samples[i - 1], mid = (samples[i] + samples[i - 1]) / 2;
      if (mid < height * 0.06 || mid > height * 0.22) continue;
      if (candidate > gap) { gap = candidate; middle = mid; }
    }
    return { h, width: gap > height * 0.008 ? middle / height : torsoHalfWidth(h) * halfWidth / height };
  });
}

function armWidthAt(boundary: ArmBoundary, h: number): number {
  if (h <= boundary[0].h) return boundary[0].width;
  for (let i = 1; i < boundary.length; i++) {
    if (h > boundary[i].h) continue;
    const a = boundary[i - 1], b = boundary[i];
    const t = (h - a.h) / (b.h - a.h), smooth = t * t * (3 - 2 * t);
    return a.width + (b.width - a.width) * smooth;
  }
  return boundary[boundary.length - 1].width;
}

/** Signed region fields on ORIGINAL vertices. Interpolate the selected field
 * across each triangle and keep values >= 0 in the shader, ray pick and camera
 * bounds. Never interpolate categorical region IDs: that invents other body
 * parts between their numbers. Fields remain attached through shape/pose and
 * do not alter positions, UVs, topology or saved tattoo anchors.
 *
 * Values are distances in fractions of body height. All fingers belong to
 * their arm; the old .42 fingertip-height threshold sliced the lowest tips.
 * smartink-live/sceneImporter.py mirrors this field for Blender render cuts. */
export function createRegionMasks(base: ArrayLike<number>, bounds: RegionBounds): BodyRegionMasks {
  const count = base.length / 3;
  const masks: BodyRegionMasks = {
    head: new Float32Array(count), torso: new Float32Array(count),
    armLeft: new Float32Array(count), armRight: new Float32Array(count),
    legLeft: new Float32Array(count), legRight: new Float32Array(count),
  };
  const { minY, height, centerX } = regionFrame(bounds), boundary = measureArmBoundary(base, bounds);
  for (let i = 0; i < count; i++) {
    const h = (base[i * 3 + 1] - minY) / height, x = (base[i * 3] - centerX) / height;
    const width = armWidthAt(boundary, h), insideTorso = width - Math.abs(x);
    masks.head[i] = h - 0.87;
    masks.torso[i] = Math.min(0.87 - h, h - 0.46, insideTorso);
    masks.armLeft[i] = Math.min(h - 0.32, 0.87 - h, x - width);
    masks.armRight[i] = Math.min(h - 0.32, 0.87 - h, -x - width);
    masks.legLeft[i] = Math.min(0.46 - h, insideTorso, x);
    masks.legRight[i] = Math.min(0.46 - h, insideTorso, -x);
  }
  return masks;
}
