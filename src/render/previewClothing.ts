/** Lightweight, fitted casual garments. Body geometry and UVs are never edited. */
import * as THREE from 'three';
import type { BodyAppearance } from './bodyAppearance';
import type { ShapeBounds } from './bodyShape';
import { torsoHalfWidth } from './bodyRegions';

type Vec = [number, number, number];
interface Template { ids: Uint32Array; representatives: number[]; faces: number[][]; neighbors: number[][]; h: Float32Array; width: Float32Array; top: Float32Array; shorts: Float32Array; trousers: Float32Array; height: number; cx: number }
const cache = new WeakMap<Float32Array, Template>();
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

function template(geometry: THREE.BufferGeometry | null, base: Float32Array, bounds: ShapeBounds): Template {
  const previous = cache.get(base);
  if (previous && (previous.faces.length || !geometry)) return previous;
  const height = bounds.maxY - bounds.minY, cx = (bounds.minX + bounds.maxX) / 2;
  const halfWidth = (bounds.maxX - bounds.minX) / 2;
  const sections = [.42, .46, .50, .54, .58, .62, .66, .70].map((h) => {
    const samples: number[] = [];
    for (let i = 0; i < base.length; i += 3) if (Math.abs((base[i + 1] - bounds.minY) / height - h) < .012) samples.push(Math.abs(base[i] - cx));
    samples.sort((a, b) => a - b);
    let gap = 0, width = torsoHalfWidth(h) * halfWidth;
    for (let i = 1; i < samples.length; i++) {
      const mid = (samples[i] + samples[i - 1]) / 2, d = samples[i] - samples[i - 1];
      if (mid >= height * .06 && mid <= height * .22 && d > gap) { gap = d; width = mid; }
    }
    return { h, width: gap > height * .008 ? width : torsoHalfWidth(h) * halfWidth };
  });
  const widthAt = (h: number) => {
    if (h <= sections[0].h) return sections[0].width;
    for (let i = 1; i < sections.length; i++) if (h <= sections[i].h) {
      const a = sections[i - 1], b = sections[i], t = (h - a.h) / (b.h - a.h);
      return a.width + (b.width - a.width) * t;
    }
    return sections[sections.length - 1].width;
  };
  const count = base.length / 3, h = new Float32Array(count), width = new Float32Array(count);
  const top = new Float32Array(count), shorts = new Float32Array(count), trousers = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = (base[i * 3] - cx) / height;
    h[i] = (base[i * 3 + 1] - bounds.minY) / height;
    width[i] = widthAt(h[i]) / height;
    const inside = width[i] - Math.abs(x);
    // Neckline is lower at the front and gently curves around the neck.
    const front = clamp((base[i * 3 + 2] / height + .02) / .08, 0, 1);
    const neck = .855 - (.014 + .014 * front) * Math.sqrt(Math.max(0, 1 - (x / .061) ** 2));
    // A-pose sleeve cut: slant along the upper arm, clear of the elbow.
    const sleeve = .718 - h[i] + Math.max(0, Math.abs(x) - .10) * .55;
    top[i] = Math.min(h[i] - .505, neck - h[i], Math.max(inside, -sleeve));
    shorts[i] = Math.min(.518 - h[i], h[i] - .335, inside);
    trousers[i] = Math.min(.518 - h[i], h[i] - .085, inside);
  }
  const ids = new Uint32Array(count), representatives: number[] = [], unique = new Map<string, number>();
  const epsilon = height * 1e-7;
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(base[i * 3] / epsilon)},${Math.round(base[i * 3 + 1] / epsilon)},${Math.round(base[i * 3 + 2] / epsilon)}`;
    let id = unique.get(key);
    if (id === undefined) { id = representatives.length; unique.set(key, id); representatives.push(i); }
    ids[i] = id;
  }
  const faces: number[][] = [], adjacency = representatives.map(() => new Set<number>());
  if (geometry) {
    const index = geometry.index, length = index?.count ?? count;
    for (let i = 0; i < length; i += 3) {
      const face = [0, 1, 2].map((k) => ids[index ? index.getX(i + k) : i + k]);
      faces.push(face);
      for (let k = 0; k < 3; k++) { adjacency[face[k]].add(face[(k + 1) % 3]); adjacency[face[k]].add(face[(k + 2) % 3]); }
    }
  }
  const result = { ids, representatives, faces, neighbors: adjacency.map((n) => [...n]), h, width, top, shorts, trousers, height, cx };
  cache.set(base, result); return result;
}

/** Positive means covered, negative means exposed; interpolate exactly as a shader varying. */
export function createClothingCoverage(base: Float32Array, bounds: ShapeBounds, appearance: BodyAppearance): Float32Array {
  const t = template(null, base, bounds), result = new Float32Array(base.length / 3).fill(-1);
  for (let i = 0; i < result.length; i++) result[i] = Math.max(appearance.top === 'tshirt' ? t.top[i] : -1,
    appearance.bottom === 'shorts' ? t.shorts[i] : appearance.bottom === 'trousers' ? t.trousers[i] : -1);
  return result;
}

/** For the preview's nonindexed body, whose original triangle order is stable. */
export function clothingCoversTriangle(coverage: Float32Array, faceIndex: number, barycentric: [number, number, number] | THREE.Vector3): boolean {
  const weights = Array.isArray(barycentric) ? barycentric : barycentric.toArray();
  const i = faceIndex * 3;
  return i >= 0 && i + 2 < coverage.length && coverage[i] * weights[0] + coverage[i + 1] * weights[1] + coverage[i + 2] * weights[2] >= 0;
}

function normalArray(points: Float32Array, faces: number[][]): Float32Array {
  const result = new Float32Array(points.length), a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const face of faces) {
    a.fromArray(points, face[0] * 3); b.fromArray(points, face[1] * 3).sub(a); c.fromArray(points, face[2] * 3).sub(a); b.cross(c);
    for (const i of face) { result[i * 3] += b.x; result[i * 3 + 1] += b.y; result[i * 3 + 2] += b.z; }
  }
  for (let i = 0; i < result.length; i += 3) a.fromArray(result, i).normalize().toArray(result, i);
  return result;
}

function relax(points: Float32Array, neighbors: number[][]): Float32Array {
  let result = points.slice();
  for (let pass = 0; pass < 18; pass++) {
    const next = result.slice();
    for (let i = 0; i < neighbors.length; i++) {
      const ns = neighbors[i]; if (!ns.length) continue;
      for (let axis = 0; axis < 3; axis++) {
        let average = 0; for (const j of ns) average += result[j * 3 + axis];
        next[i * 3 + axis] = result[i * 3 + axis] * .55 + average / ns.length * .45;
      }
    }
    result = next;
  }
  return result;
}

/** Smooth cross sections remove muscle/crease detail and give fabric room. */
function tailored(points: Float32Array, t: Template, base: Float32Array, kind: 'top' | 'shorts' | 'trousers'): Float32Array {
  const smooth = relax(points, t.neighbors), normals = normalArray(smooth, t.faces), result = smooth.slice();
  const top = kind === 'top', H = t.height;
  const sections: Array<{ y: number; side: number; cx: number; cz: number; rx: number; rz: number }> = [];
  const start = top ? .505 : (kind === 'shorts' ? .335 : .085), end = top ? .80 : .46;
  for (let h = start; h <= end + .008; h += .015) for (const side of top ? [0] : [-1, 1]) {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let j = 0; j < t.representatives.length; j++) {
      const i = t.representatives[j], x = (base[i * 3] - t.cx) / H;
      if (Math.abs(t.h[i] - h) > .016 || Math.abs(x) > t.width[i] || (side && x * side < .008)) continue;
      minX = Math.min(minX, smooth[j * 3]); maxX = Math.max(maxX, smooth[j * 3]);
      minZ = Math.min(minZ, smooth[j * 3 + 2]); maxZ = Math.max(maxZ, smooth[j * 3 + 2]);
    }
    if (Number.isFinite(minX)) sections.push({ y: h, side, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, rx: (maxX - minX) / 2, rz: (maxZ - minZ) / 2 });
  }
  for (let j = 0; j < t.representatives.length; j++) {
    const i = t.representatives[j], h = t.h[i], x = (base[i * 3] - t.cx) / H;
    const inside = Math.abs(x) < t.width[i] - .004;
    const ease = H * (top ? .013 + .014 * clamp((.75 - h) / .24, 0, 1) : .012);
    for (let axis = 0; axis < 3; axis++) result[j * 3 + axis] += normals[j * 3 + axis] * ease;
    // Planar cuts stay crisp; surface relaxation must not scallop the hems.
    result[j * 3 + 1] = points[j * 3 + 1];
    if (!inside || h < start || h > end) continue;
    const side = top ? 0 : x < 0 ? -1 : 1, available = sections.filter((s) => s.side === side);
    if (!available.length) continue;
    let lower = available[0], upper = available[available.length - 1];
    for (const candidate of available) {
      if (candidate.y <= h) lower = candidate;
      if (candidate.y >= h) { upper = candidate; break; }
    }
    const weight = clamp((h - lower.y) / Math.max(.0001, upper.y - lower.y), 0, 1);
    const s = { cx: lower.cx + (upper.cx - lower.cx) * weight, cz: lower.cz + (upper.cz - lower.cz) * weight,
      rx: lower.rx + (upper.rx - lower.rx) * weight, rz: lower.rz + (upper.rz - lower.rz) * weight };
    // Waist and lower legs hang away from the anatomy rather than shrink-wrap.
    const breadth = top ? 0 : kind === 'trousers' ? H * .035 : H * .044;
    const rx = Math.max(breadth, s.rx) + ease, rz = Math.max(breadth * .95, s.rz) + ease;
    const angle = Math.atan2((smooth[j * 3 + 2] - s.cz) / Math.max(.001, s.rz), (smooth[j * 3] - s.cx) / Math.max(.001, s.rx));
    const blend = top ? clamp((.805 - h) / .045, 0, 1) : clamp((.46 - h) / .05, 0, 1);
    result[j * 3] += (s.cx + rx * Math.cos(angle) - result[j * 3]) * blend;
    result[j * 3 + 2] += (s.cz + rz * Math.sin(angle) - result[j * 3 + 2]) * blend;
  }
  return result;
}

function transportOffsets(shaped: Float32Array, posed: Float32Array, garment: Float32Array, t: Template): Float32Array {
  const n0 = normalArray(shaped, t.faces), n1 = normalArray(posed, t.faces), result = new Float32Array(garment.length);
  const oldN = new THREE.Vector3(), newN = new THREE.Vector3(), oldT = new THREE.Vector3(), newT = new THREE.Vector3();
  const oldB = new THREE.Vector3(), newB = new THREE.Vector3(), offset = new THREE.Vector3(), point = new THREE.Vector3();
  for (let i = 0; i < t.representatives.length; i++) {
    oldN.fromArray(n0, i * 3); newN.fromArray(n1, i * 3);
    const neighbor = t.neighbors[i][0] ?? i;
    oldT.fromArray(shaped, neighbor * 3).sub(point.fromArray(shaped, i * 3)).addScaledVector(oldN, -oldT.dot(oldN)).normalize();
    newT.fromArray(posed, neighbor * 3).sub(point.fromArray(posed, i * 3)).addScaledVector(newN, -newT.dot(newN)).normalize();
    oldB.crossVectors(oldN, oldT); newB.crossVectors(newN, newT);
    offset.fromArray(garment, i * 3).sub(point.fromArray(shaped, i * 3));
    point.fromArray(posed, i * 3).addScaledVector(newT, offset.dot(oldT)).addScaledVector(newB, offset.dot(oldB)).addScaledVector(newN, offset.dot(oldN));
    point.toArray(result, i * 3);
  }
  return result;
}

function clippedGarment(points: Float32Array, t: Template, field: Float32Array, color: string, name: string): THREE.Group {
  const positions: number[] = [], indices: number[] = [], vertexMap = new Map<string, number>(), hems: Array<[number, number]> = [];
  const vertex = (key: string, point: Vec) => { const existing = vertexMap.get(key); if (existing !== undefined) return existing; const id = positions.length / 3; positions.push(...point); vertexMap.set(key, id); return id; };
  const coordinate = (i: number): Vec => [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
  for (const face of t.faces) {
    const polygon: number[] = [], cut: number[] = [];
    for (let k = 0; k < 3; k++) {
      const a = face[k], b = face[(k + 1) % 3], fa = field[t.representatives[a]], fb = field[t.representatives[b]];
      if (fa >= 0) polygon.push(vertex(String(a), coordinate(a)));
      if ((fa >= 0) !== (fb >= 0)) {
        const p = coordinate(a), q = coordinate(b), weight = fa / (fa - fb);
        const id = vertex(`${Math.min(a, b)}:${Math.max(a, b)}`, p.map((n, axis) => n + (q[axis] - n) * weight) as Vec);
        polygon.push(id); cut.push(id);
      }
    }
    for (let k = 1; k + 1 < polygon.length; k++) indices.push(polygon[0], polygon[k], polygon[k + 1]);
    if (cut.length === 2) hems.push([cut[0], cut[1]]);
  }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ color, roughness: .92, metalness: 0, side: THREE.DoubleSide });
  const group = new THREE.Group(), cloth = new THREE.Mesh(geometry, material); cloth.name = name; cloth.castShadow = true; cloth.receiveShadow = true; group.add(cloth);
  const hemPositions: number[] = [], hemIndices: number[] = [], normals = geometry.getAttribute('normal'), thickness = t.height * .0018;
  for (const [a, b] of hems) {
    const offset = hemPositions.length / 3;
    for (const [i, inner] of [[a, 0], [b, 0], [a, 1], [b, 1]]) {
      hemPositions.push(positions[i * 3] - normals.getX(i) * thickness * inner, positions[i * 3 + 1] - normals.getY(i) * thickness * inner, positions[i * 3 + 2] - normals.getZ(i) * thickness * inner);
    }
    hemIndices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
  }
  const hemGeometry = new THREE.BufferGeometry(); hemGeometry.setAttribute('position', new THREE.Float32BufferAttribute(hemPositions, 3)); hemGeometry.setIndex(hemIndices); hemGeometry.computeVertexNormals();
  const hemMaterial = material.clone(); hemMaterial.color.multiplyScalar(.8);
  const hem = new THREE.Mesh(hemGeometry, hemMaterial); hem.name = `${name} hems`; group.add(hem);
  return group;
}

/** Attach directly to the body mesh: all returned points use its local space.
 * The optional freshly shaped snapshot allows relaxed fabric to be tailored
 * before transporting its offsets through the final posed skin frames. */
export function createClothing(geometry: THREE.BufferGeometry, base: Float32Array, bounds: ShapeBounds, appearance: BodyAppearance, shapedPositions?: Float32Array): THREE.Group {
  const group = new THREE.Group(); group.name = 'Casual clothing'; group.userData.previewAppearance = 'clothing';
  if (appearance.top === 'none' && appearance.bottom === 'none') return group;
  const t = template(geometry, base, bounds), position = geometry.getAttribute('position');
  const posed = new Float32Array(t.representatives.length * 3), shaped = new Float32Array(posed.length);
  for (let j = 0; j < t.representatives.length; j++) {
    const i = t.representatives[j];
    posed[j * 3] = position.getX(i); posed[j * 3 + 1] = position.getY(i); posed[j * 3 + 2] = position.getZ(i);
    shaped[j * 3] = shapedPositions?.[i * 3] ?? posed[j * 3]; shaped[j * 3 + 1] = shapedPositions?.[i * 3 + 1] ?? posed[j * 3 + 1]; shaped[j * 3 + 2] = shapedPositions?.[i * 3 + 2] ?? posed[j * 3 + 2];
  }
  for (const kind of [appearance.top === 'tshirt' ? 'top' : null, appearance.bottom === 'none' ? null : appearance.bottom] as const) {
    if (!kind) continue;
    const tailoredPoints = tailored(shaped, t, base, kind), points = transportOffsets(shaped, posed, tailoredPoints, t);
    group.add(clippedGarment(points, t, t[kind], kind === 'top' ? appearance.topColor : appearance.bottomColor, kind === 'top' ? 'T-shirt' : kind === 'shorts' ? 'Shorts' : 'Trousers'));
  }
  return group;
}
