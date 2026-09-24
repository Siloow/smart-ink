export type V3 = [number, number, number];
export interface FitDescriptor { key: string; kind: string; side: number; f: number; origin: V3; normal: V3; edges: number[]; ids: number[]; delta: number[] }
export interface FitAsset { version: 1; sex: string; H: number; baseline: Record<string, number>; positions: number[]; indices: number[]; descriptors: FitDescriptor[]; arms: { side: number; wrist: V3; elbow: V3; axis: V3; length: number; shift: number[] }[] }
export interface BodyFit { version: 1; bodyMeshId: string; measurements: Record<string, number>; parameters: number[]; armDeltas: number[]; maxErrorMm: number }
export interface FitResult { fit: BodyFit; positions: Float32Array }
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v: V3): V3 => { const l = Math.hypot(...v); return v.map(n => n / l) as V3; };

/** Monotone cubic Hermite height warp, matching the prototype's PCHIP. */
export function heightWarp(H: number, height: number, inseam: number) {
  const scale = height / (H * 100), x = [0, .07 * H, .47 * H, .84 * H, H], y = [0, .07 * H * scale, inseam / 100, .84 * H * scale, H * scale];
  const h = x.slice(1).map((n, i) => n - x[i]), d = y.slice(1).map((n, i) => (n - y[i]) / h[i]), m = new Array<number>(5);
  const end = (h0: number, h1: number, d0: number, d1: number) => { let n = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1); if (Math.sign(n) !== Math.sign(d0)) n = 0; else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(n) > Math.abs(3 * d0)) n = 3 * d0; return n; };
  m[0] = end(h[0], h[1], d[0], d[1]); m[4] = end(h[3], h[2], d[3], d[2]);
  for (let i = 1; i < 4; i++) { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = d[i - 1] * d[i] <= 0 ? 0 : (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  const sample = (n: number, derivative = false) => {
    let i = 0; while (i < 3 && n > x[i + 1]) i++;
    const t = (n - x[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return derivative ? ((6 * t2 - 6 * t) * y[i] + (-6 * t2 + 6 * t) * y[i + 1]) / h[i] + (3 * t2 - 4 * t + 1) * m[i] + (3 * t2 - 2 * t) * m[i + 1]
      : (2 * t3 - 3 * t2 + 1) * y[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * y[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
  return { scale, sample, point: (p: V3): V3 => [p[0] * scale, sample(p[1]), p[2] * scale] };
}
function perimeter(positions: Float64Array | number[], edges: number[], origin: V3, normal: V3) {
  const u = unit(cross(normal, Math.abs(normal[2]) < .9 ? [0, 0, 1] : [1, 0, 0])), v = cross(normal, u), points: [number, number][] = [];
  for (let i = 0; i < edges.length; i += 2) {
    const a = edges[i] * 3, b = edges[i + 1] * 3;
    const da = (positions[a] - origin[0]) * normal[0] + (positions[a + 1] - origin[1]) * normal[1] + (positions[a + 2] - origin[2]) * normal[2];
    const db = (positions[b] - origin[0]) * normal[0] + (positions[b + 1] - origin[1]) * normal[1] + (positions[b + 2] - origin[2]) * normal[2];
    if (da * db > 0 || Math.abs(da - db) < 1e-12) continue;
    const t = da / (da - db), p: V3 = [positions[a] + t * (positions[b] - positions[a]), positions[a + 1] + t * (positions[b + 1] - positions[a + 1]), positions[a + 2] + t * (positions[b + 2] - positions[a + 2])];
    points.push([dot(p, u), dot(p, v)]);
  }
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (points.length < 3) throw new Error('This combination leaves an incomplete measurement band. Check your values.');
  const turn = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const half = (ps: typeof points) => { const out: typeof points = []; for (const p of ps) { while (out.length > 1 && turn(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop(); out.push(p); } out.pop(); return out; };
  const hull = [...half(points), ...half([...points].reverse())];
  return hull.reduce((length, p, i) => { const next = hull[(i + 1) % hull.length]; return length + Math.hypot(p[0] - next[0], p[1] - next[1]); }, 0) * 100;
}
export function deformFit(asset: FitAsset, fit: BodyFit): Float64Array {
  const out = Float64Array.from(asset.positions), warp = heightWarp(asset.H, fit.measurements.height, fit.measurements.inseam);
  asset.arms.forEach((a, j) => { for (let i = 0; i < a.shift.length; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] += a.shift[i] * fit.armDeltas[j] * a.axis[k]; });
  asset.descriptors.forEach((d, j) => { const amount = Math.expm1(fit.parameters[j]); for (let i = 0; i < d.ids.length; i++) for (let k = 0; k < 3; k++) out[d.ids[i] * 3 + k] += amount * d.delta[i * 3 + k]; });
  for (let i = 0; i < out.length; i += 3) { out[i] *= warp.scale; out[i + 1] = warp.sample(out[i + 1]); out[i + 2] *= warp.scale; }
  return out;
}
export function solveFit(asset: FitAsset, bodyMeshId: string, values: Record<string, number>): FitResult {
  if (Object.keys(values).length !== Object.keys(asset.baseline).length) throw new Error('Complete all 15 measurements.');
  for (const [key, base] of Object.entries(asset.baseline)) if (!Number.isFinite(values[key]) || values[key] / base < .75 || values[key] / base > 1.4) throw new Error('A measurement is outside this template’s supported range.');
  if (values.inseam / values.height <= .38 || values.inseam / values.height >= .55) throw new Error('Check height and inseam: this template supports an inseam between 38% and 55% of height.');
  const warp = heightWarp(asset.H, values.height, values.inseam);
  const fit: BodyFit = { version: 1, bodyMeshId, measurements: { ...values }, parameters: asset.descriptors.map(() => 0), armDeltas: [], maxErrorMm: Infinity };
  fit.armDeltas = asset.arms.map(a => { const elbow = warp.point(a.elbow); let lo = -a.length, hi = a.length * .65;
    for (let i = 0; i < 45; i++) { const mid = (lo + hi) / 2, wrist = warp.point(a.wrist.map((n, k) => n + mid * a.axis[k]) as V3), length = Math.hypot(...sub(elbow, wrist)); if (length > values.armLength / 100) lo = mid; else hi = mid; } return (lo + hi) / 2; });
  const planes = asset.descriptors.map(d => { const origin = [...d.origin] as V3, arm = asset.arms.findIndex(a => a.side === d.side);
    if (d.kind === 'arm') for (let k = 0; k < 3; k++) origin[k] += d.normal[k] * fit.armDeltas[arm] * (1 - clamp(d.f, 0, 1));
    return { origin: warp.point(origin), normal: unit([d.normal[0] / warp.scale, d.normal[1] / warp.sample(origin[1], true), d.normal[2] / warp.scale]) }; });
  const measure = (positions: Float64Array) => asset.descriptors.map((d, i) => { const o = [...planes[i].origin] as V3; if (d.kind === 'arm') o[0] += d.side * asset.H * .105 * warp.scale * Math.expm1(fit.parameters[1]); return perimeter(positions, d.edges, o, planes[i].normal); });
  let positions = deformFit(asset, fit), achieved = measure(positions);
  // Damped multiplicative radius updates converge for the locally supported bands.
  for (let iteration = 0; iteration < 70; iteration++) {
    fit.maxErrorMm = Math.max(...achieved.map((n, i) => Math.abs(n - values[asset.descriptors[i].key]) * 10));
    if (fit.maxErrorMm < .4) break;
    fit.parameters = fit.parameters.map((p, i) => clamp(p + .65 * Math.log(values[asset.descriptors[i].key] / achieved[i]), -.85, .85));
    positions = deformFit(asset, fit); achieved = measure(positions);
  }
  fit.maxErrorMm = Math.max(...achieved.map((n, i) => Math.abs(n - values[asset.descriptors[i].key]) * 10));
  if (fit.maxErrorMm > 2) throw new Error('This template could not match that combination. Check your measurements or try a less extreme fit.');
  // Reject inverted or collapsed faces before replacing any user's current body.
  const p = asset.positions, idx = asset.indices;
  const point = (data: ArrayLike<number>, i: number): V3 => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]];
  for (let i = 0; i < idx.length; i += 3) {
    const a = point(p, idx[i]), b = point(p, idx[i + 1]), c = point(p, idx[i + 2]), before = cross(sub(b, a), sub(c, a));
    if (Math.hypot(...before) < 1e-10) continue;
    const aa = point(positions, idx[i]), bb = point(positions, idx[i + 1]), cc = point(positions, idx[i + 2]), after = cross(sub(bb, aa), sub(cc, aa));
    if (dot(before, after) <= 0 || Math.hypot(...after) / Math.hypot(...before) < .15) throw new Error('These measurements pinch this template. Check your values or try a less extreme combination.');
  }
  return { fit, positions: Float32Array.from(positions) };
}
