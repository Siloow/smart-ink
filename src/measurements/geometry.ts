import * as THREE from 'three';

export interface MeasurementGuide { lines: THREE.Vector3[][]; target: THREE.Vector3; span: number; width: number }
const TORSO: Record<string, number> = { neck: .855, chest: .725, waist: .605, hips: .515 };
const LEGS: Record<string, number> = { thigh: .415, calf: .19, ankle: .085 };
const ARMS: Record<string, number> = { wrist: 0, forearmLow: 1 / 3, forearm: 2 / 3, belowElbow: .95, upperArm: 1.48 };

/** Convex tape perimeter through the selected surface, excluding the opposite limb. */
function section(mesh: THREE.Mesh, origin: THREE.Vector3, normal: THREE.Vector3, accepts: (p: THREE.Vector3) => boolean) {
  const pos = mesh.geometry.getAttribute('position'), index = mesh.geometry.index;
  const points: THREE.Vector3[] = [], a = new THREE.Vector3(), b = new THREE.Vector3();
  const count = index?.count ?? pos.count;
  for (let i = 0; i < count; i += 3) for (const [j, k] of [[0, 1], [1, 2], [2, 0]]) {
    a.fromBufferAttribute(pos, index ? index.getX(i + j) : i + j);
    b.fromBufferAttribute(pos, index ? index.getX(i + k) : i + k);
    if (!accepts(a) || !accepts(b)) continue;
    const da = normal.dot(a.clone().sub(origin)), db = normal.dot(b.clone().sub(origin));
    if (da * db <= 0 && Math.abs(da - db) > 1e-9) points.push(a.clone().lerp(b, da / (da - db)));
  }
  const u = new THREE.Vector3().crossVectors(normal, Math.abs(normal.z) < .9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize();
  const v = new THREE.Vector3().crossVectors(normal, u);
  const seen = new Set<string>();
  const flat = points.map(p => ({ x: p.dot(u), y: p.dot(v), p })).filter(p => { const key = `${p.x.toFixed(6)}:${p.y.toFixed(6)}`; if (seen.has(key)) return false; seen.add(key); return true; }).sort((a, b) => a.x - b.x || a.y - b.y);
  if (flat.length < 3) return [];
  const cross = (a: typeof flat[0], b: typeof flat[0], c: typeof flat[0]) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (ps: typeof flat) => { const out: typeof flat = []; for (const p of ps) { while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop(); out.push(p); } out.pop(); return out; };
  const hull = [...half(flat), ...half([...flat].reverse())].map(p => p.p);
  return [...hull, hull[0].clone()];
}

export function measurementGuide(mesh: THREE.Mesh, key: string): MeasurementGuide {
  mesh.updateWorldMatrix(true, false); mesh.geometry.computeBoundingBox();
  const box = mesh.geometry.boundingBox!, size = box.getSize(new THREE.Vector3()), height = size.y;
  const y = (fraction: number) => box.min.y + height * fraction;
  const h = (p: THREE.Vector3) => (p.y - box.min.y) / height;
  // Infer the clear silhouette gap independently for each model and current shape.
  const pos = mesh.geometry.getAttribute('position');
  const split = (fraction: number) => {
    const xs: number[] = [];
    for (let i = 0; i < pos.count; i++) if (Math.abs((pos.getY(i) - box.min.y) / height - fraction) < .014) xs.push(Math.abs(pos.getX(i)));
    xs.sort((a, b) => a - b); let best = 0, at = height * .14;
    for (let i = 1; i < xs.length; i++) { const mid = (xs[i] + xs[i - 1]) / 2, gap = xs[i] - xs[i - 1]; if (mid > height * .065 && mid < height * .23 && gap > best) { best = gap; at = mid; } }
    return at;
  };
  let lines: THREE.Vector3[][] = [], target = box.getCenter(new THREE.Vector3()), span = height * 1.22, width = size.x * 1.15;
  const bracket = (a: THREE.Vector3, b: THREE.Vector3) => { const tick = new THREE.Vector3(height * .014, 0, 0); return [[a, b], [a.clone().sub(tick), a.clone().add(tick)], [b.clone().sub(tick), b.clone().add(tick)]]; };
  if (key === 'height') { const x = box.max.x + height * .045; lines = bracket(new THREE.Vector3(x, box.min.y, 0), new THREE.Vector3(x, box.max.y, 0)); width += height * .12; }
  else if (key === 'inseam') { const a = new THREE.Vector3(height * .018, box.min.y, height * .03), b = a.clone().setY(y(.47)); lines = bracket(a, b); target = a.clone().lerp(b, .5); span = height * .6; width = height * .3; }
  else if (Object.hasOwn(TORSO, key) || Object.hasOwn(LEGS, key)) {
    const leg = Object.hasOwn(LEGS, key), fraction = leg ? LEGS[key] : TORSO[key], boundary = split(Math.min(.7, fraction));
    const ring = section(mesh, new THREE.Vector3(0, y(fraction), 0), new THREE.Vector3(0, 1, 0), p => leg ? p.x > 0 : key === 'neck' || Math.abs(p.x) < boundary);
    if (ring.length) { lines = [ring]; const bounds = new THREE.Box3().setFromPoints(ring); target = bounds.getCenter(new THREE.Vector3()); width = bounds.getSize(new THREE.Vector3()).x * 1.6; span = height * (key === 'neck' ? .22 : leg ? .28 : .34); }
  } else if (Object.hasOwn(ARMS, key) || key === 'armLength') {
    const landmark = (fraction: number) => { const boundary = split(fraction), b = new THREE.Box3(); for (let i = 0; i < pos.count; i++) { const p = new THREE.Vector3().fromBufferAttribute(pos, i); if (Math.abs(h(p) - fraction) < .009 && p.x > boundary) b.expandByPoint(p); } return b.isEmpty() ? new THREE.Vector3(height * .19, y(fraction), 0) : b.getCenter(new THREE.Vector3()); };
    const wrist = landmark(.535), elbow = landmark(.645), axis = elbow.clone().sub(wrist).normalize();
    if (key === 'armLength') { const offset = new THREE.Vector3(height * .033, 0, height * .04); lines = bracket(wrist.clone().add(offset), elbow.clone().add(offset)); target = wrist.clone().lerp(elbow, .5); span = wrist.distanceTo(elbow) * 2; width = height * .23; }
    else { const origin = wrist.clone().lerp(elbow, ARMS[key]), boundary = split(Math.min(.7, h(origin)));
      const ring = section(mesh, origin, axis, p => p.x > boundary && h(p) > .35 && h(p) < .8);
      if (ring.length) { lines = [ring]; const bounds = new THREE.Box3().setFromPoints(ring); target = bounds.getCenter(new THREE.Vector3()); width = bounds.getSize(new THREE.Vector3()).x * 1.8; span = height * (key === 'wrist' ? .17 : .24); }
    }
  }
  const scale = mesh.getWorldScale(new THREE.Vector3()).y;
  return { lines: lines.map(line => line.map(p => p.applyMatrix4(mesh.matrixWorld))), target: target.applyMatrix4(mesh.matrixWorld), span: span * scale, width: width * scale };
}
