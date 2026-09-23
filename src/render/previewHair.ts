import * as THREE from 'three';
import { HAIR_TONES, type BodyAppearance } from './bodyAppearance';

type Bounds = { minX: number; maxX: number; minY: number; maxY: number };
type Corner = { p: THREE.Vector3; n: THREE.Vector3; original: THREE.Vector3; field: number };
const smooth = (a: number, b: number, value: number) => { const t = THREE.MathUtils.clamp((value - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const noise = (x: number) => { const n = Math.sin(x * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); };

/** Original-space scalp boundary: high forehead, tapered temples, low nape.
 * Using undeformed points keeps the hairline attached during shape/pose edits. */
export function createHairScalpField(base: ArrayLike<number>, bounds: Bounds): Float32Array {
  const height = Math.max(1e-6, bounds.maxY - bounds.minY), cx = (bounds.minX + bounds.maxX) / 2;
  let minZ = Infinity, maxZ = -Infinity, halfX = 0;
  for (let i = 0; i < base.length; i += 3) if ((base[i + 1] - bounds.minY) / height > .95) {
    minZ = Math.min(minZ, base[i + 2]); maxZ = Math.max(maxZ, base[i + 2]); halfX = Math.max(halfX, Math.abs(base[i] - cx));
  }
  const cz = (minZ + maxZ) / 2, rz = Math.max(1e-6, (maxZ - minZ) / 2);
  const output = new Float32Array(base.length / 3);
  for (let i = 0; i < output.length; i++) {
    const h = (base[i * 3 + 1] - bounds.minY) / height, x = (base[i * 3] - cx) / Math.max(1e-6, halfX), z = (base[i * 3 + 2] - cz) / rz;
    const front = smooth(-.25, .72, z);
    const temple = smooth(.38, .9, Math.abs(x)) * smooth(.05, .6, z);
    const earArch = .025 * Math.exp(-Math.pow((z + .1) / .48, 2)) * smooth(.65, .98, Math.abs(x));
    const hairline = .919 + .042 * front + .006 * temple + earArch + .0008 * Math.sin(x * 23 + z * 17) + .0004 * Math.sin(x * 57 - z * 11);
    output[i] = (h - hairline) * height;
  }
  return output;
}

/** Pick protection matches the scalp foundation, with a small edge feather. */
export function createHairCoverage(base: ArrayLike<number>, bounds: Bounds, appearance: Pick<BodyAppearance, 'hairStyle'>): Float32Array {
  if (appearance.hairStyle === 'none') return new Float32Array(base.length / 3);
  const field = createHairScalpField(base, bounds), feather = (bounds.maxY - bounds.minY) * .001;
  return Float32Array.from(field, (value) => THREE.MathUtils.clamp(.5 + value / feather, 0, 1));
}

function clipped(corners: Corner[]): Corner[] {
  const result: Corner[] = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i], b = corners[(i + 1) % corners.length];
    if (a.field >= 0) result.push(a);
    if ((a.field >= 0) !== (b.field >= 0)) {
      const t = a.field / (a.field - b.field);
      result.push({ p: a.p.clone().lerp(b.p, t), n: a.n.clone().lerp(b.n, t).normalize(), original: a.original.clone().lerp(b.original, t), field: 0 });
    }
  }
  return result;
}

/** Lightweight scalp foundation and tapered, swept locks; parent to the body
 * mesh, then rebuild after a shape/pose change. No textures or remote assets. */
export function createPreviewHair(geometry: THREE.BufferGeometry, base: ArrayLike<number>, bounds: Bounds, appearance: Pick<BodyAppearance, 'hairStyle' | 'hairTone'>): THREE.Group {
  const group = new THREE.Group(); group.name = 'Preview hair'; group.userData.previewAppearance = 'hair';
  if (appearance.hairStyle === 'none') return group;
  const short = appearance.hairStyle === 'short', height = bounds.maxY - bounds.minY;
  const field = createHairScalpField(base, bounds), position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal'), index = geometry.index;
  const color = new THREE.Color(HAIR_TONES.find((tone) => tone.id === appearance.hairTone)?.color ?? '#302219');
  const positions: number[] = [], normals: number[] = [], colors: number[] = [];
  const triangles: Corner[][] = []; let area = 0;
  for (let f = 0; f < (index?.count ?? position.count); f += 3) {
    const ids = [0, 1, 2].map((k) => index ? index.getX(f + k) : f + k);
    if (ids.every((i) => field[i] < 0)) continue;
    const polygon = clipped(ids.map((i) => ({ p: new THREE.Vector3().fromBufferAttribute(position, i), n: new THREE.Vector3().fromBufferAttribute(normal, i).normalize(), original: new THREE.Vector3().fromArray(base, i * 3), field: field[i] })));
    for (let k = 1; k + 1 < polygon.length; k++) {
      const triangle = [polygon[0], polygon[k], polygon[k + 1]];
      area += new THREE.Triangle(...triangle.map((c) => c.p) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]).getArea(); triangles.push(triangle);
    }
  }
  const add = (p: THREE.Vector3, n: THREE.Vector3, shade: number) => { positions.push(p.x, p.y, p.z); normals.push(n.x, n.y, n.z); colors.push(color.r * shade, color.g * shade, color.b * shade); };
  const offset = height * (short ? .0010 : .0005);
  for (const triangle of triangles) for (const c of triangle) {
    const grain = noise(c.original.x * 151 + c.original.y * 89 + c.original.z * 173);
    add(c.p.clone().addScaledVector(c.n, offset), c.n, .70 + grain * .14);
  }
  let totalLocks = 0;
  for (let face = 0; face < triangles.length; face++) {
    const triangle = triangles[face], [a, b, c] = triangle;
    const faceArea = new THREE.Triangle(a.p, b.p, c.p).getArea();
    const desired = faceArea / Math.max(area, 1e-12) * (short ? 1500 : 1100);
    const count = Math.floor(desired) + (noise(face + 71) < desired % 1 ? 1 : 0);
    const e1 = b.original.clone().sub(a.original), e2 = c.original.clone().sub(a.original), originalNormal = new THREE.Vector3().crossVectors(e1, e2).normalize();
    const groom = new THREE.Vector3(.38, -.65, -.55).addScaledVector(originalNormal, -new THREE.Vector3(.38, -.65, -.55).dot(originalNormal));
    const d11 = e1.dot(e1), d12 = e1.dot(e2), d22 = e2.dot(e2), determinant = d11 * d22 - d12 * d12;
    if (Math.abs(determinant) < 1e-18) continue;
    const u = (groom.dot(e1) * d22 - groom.dot(e2) * d12) / determinant, v = (groom.dot(e2) * d11 - groom.dot(e1) * d12) / determinant;
    const currentGroom = b.p.clone().sub(a.p).multiplyScalar(u).addScaledVector(c.p.clone().sub(a.p), v).normalize();
    for (let lock = 0; lock < count; lock++) {
      const seed = face * 31 + lock * 13, r = Math.sqrt(noise(seed + 1)), weights = [1 - r, r * (1 - noise(seed + 2)), r * noise(seed + 2)];
      const p = new THREE.Vector3(), n = new THREE.Vector3(), original = new THREE.Vector3();
      triangle.forEach((corner, k) => { p.addScaledVector(corner.p, weights[k]); n.addScaledVector(corner.n, weights[k]); original.addScaledVector(corner.original, weights[k]); }); n.normalize();
      const crown = smooth(.935, .985, (original.y - bounds.minY) / height);
      const length = height * (short ? .003 + .007 * crown : .0011 + .0004 * crown) * (.7 + .6 * noise(seed + 3));
      const width = height * (short ? .0010 : .00065) * (.65 + noise(seed + 4) * .7);
      const tangent = currentGroom.clone().addScaledVector(n, -currentGroom.dot(n)).normalize(), across = new THREE.Vector3().crossVectors(n, tangent).normalize();
      const root = p.clone().addScaledVector(n, offset * .8), mid = root.clone().addScaledVector(n, length * .45).addScaledVector(tangent, length * .55), tip = root.clone().addScaledVector(n, length * .27).addScaledVector(tangent, length * 1.2);
      const l = root.clone().addScaledVector(across, -width), rr = root.clone().addScaledVector(across, width), ml = mid.clone().addScaledVector(across, -width * .5), mr = mid.clone().addScaledVector(across, width * .5);
      const shade = .86 + noise(seed + 7) * .25;
      for (const [point, multiplier] of [[l, .9], [rr, .9], [ml, 1], [rr, .9], [mr, 1], [ml, 1], [ml, 1], [mr, 1], [tip, 1.02]] as [THREE.Vector3, number][]) add(point, n, shade * multiplier);
      totalLocks++;
    }
  }
  const hairGeometry = new THREE.BufferGeometry(); hairGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); hairGeometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); hairGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); hairGeometry.computeBoundingSphere();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .84, metalness: 0, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(hairGeometry, material); mesh.name = `${appearance.hairStyle} scalp and locks`; mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
  group.userData.lockCount = totalLocks; group.userData.triangleCount = positions.length / 9;
  return group;
}

export function disposePreviewHair(group: THREE.Group): void {
  group.traverse((child) => { const mesh = child as THREE.Mesh; if (!mesh.isMesh) return; mesh.geometry.dispose(); const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; materials.forEach((material) => material.dispose()); });
  group.removeFromParent();
}
