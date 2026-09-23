import * as THREE from 'three';

/** A persistent point on the skin; independent of its UV atlas and body shape. */
export interface SurfaceAnchor {
  faceIndex: number;
  barycentric: [number, number, number];
  bodyMeshId: string;
}

export interface SurfaceChart {
  /** Centre-relative, physical world-unit coordinates, one pair per render vertex. */
  uv: Float32Array;
  /** Only chart vertices have value 1. Reject interpolated values below 0.9999. */
  mask: Float32Array;
  /** Exact whole-triangle support, in original faceIndex order. Apply to all
   * three corners of a non-indexed render/bake mesh; vertex masks alone cannot
   * reject one of two adjacent faces without also cutting the other face. */
  faceMask: Float32Array;
  /** Conservative square edge-length recommendation for every rotation.
   * Metadata only: clipping an overlapping face never changes this bound,
   * the UV coordinates, or the user's selected tattoo size. */
  maxSize: number;
  message?: string;
}

export interface SurfaceTopology {
  vertexCount: number;
  welded: Int32Array;
  representatives: number[];
  faces: Int32Array;
  neighbours: number[][];
  incidentFaces: number[][];
}

export function validateSurfaceAnchor(
  value: unknown,
  geometry?: THREE.BufferGeometry,
): value is SurfaceAnchor {
  if (!value || typeof value !== 'object') return false;
  const a = value as Partial<SurfaceAnchor>;
  if (!Number.isInteger(a.faceIndex) || a.faceIndex! < 0 || typeof a.bodyMeshId !== 'string') return false;
  if (!Array.isArray(a.barycentric) || a.barycentric.length !== 3) return false;
  if (a.barycentric.some((n) => !Number.isFinite(n) || n < -0.0001 || n > 1.0001)) return false;
  if (Math.abs(a.barycentric.reduce((sum, n) => sum + n, 0) - 1) > 0.001) return false;
  if (geometry && a.faceIndex! >= (geometry.index?.count ?? geometry.getAttribute('position').count) / 3) return false;
  return true;
}

/**
 * GLTF duplicates a skin vertex at every atlas seam. Welding ONLY positions
 * gives the parameterizer the actual surface while retaining the original
 * render vertices and original UVs for lighting and export.
 */
export function createSurfaceTopology(geometry: THREE.BufferGeometry): SurfaceTopology {
  const positions = geometry.getAttribute('position');
  const count = positions.count;
  const bounds = new THREE.Box3().setFromBufferAttribute(positions as THREE.BufferAttribute);
  const epsilon = Math.max(1e-8, bounds.getSize(new THREE.Vector3()).length() * 1e-6);
  const buckets = new Map<string, number[]>();
  const welded = new Int32Array(count);
  const representatives: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i);
    const qx = Math.floor(x / epsilon), qy = Math.floor(y / epsilon), qz = Math.floor(z / epsilon);
    let match = -1;
    // Adjacent buckets matter: rounding alone can split coincident seam vertices.
    for (let dx = -1; dx <= 1 && match < 0; dx++) {
      for (let dy = -1; dy <= 1 && match < 0; dy++) {
        for (let dz = -1; dz <= 1 && match < 0; dz++) {
          for (const id of buckets.get(`${qx + dx},${qy + dy},${qz + dz}`) ?? []) {
            const r = representatives[id];
            if (Math.hypot(x - positions.getX(r), y - positions.getY(r), z - positions.getZ(r)) <= epsilon) {
              match = id;
              break;
            }
          }
        }
      }
    }
    if (match < 0) {
      match = representatives.length;
      representatives.push(i);
      const key = `${qx},${qy},${qz}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(match);
      buckets.set(key, bucket);
    }
    welded[i] = match;
  }
  const index = geometry.getIndex();
  const faces = new Int32Array(index?.count ?? count);
  const adjacency = representatives.map(() => new Set<number>());
  const incidentFaces = representatives.map(() => [] as number[]);
  for (let i = 0; i < faces.length; i++) faces[i] = welded[index ? index.getX(i) : i];
  for (let i = 0; i < faces.length; i += 3) {
    const a = faces[i], b = faces[i + 1], c = faces[i + 2];
    if (a === b || b === c || c === a) continue;
    adjacency[a].add(b); adjacency[a].add(c);
    adjacency[b].add(a); adjacency[b].add(c);
    adjacency[c].add(a); adjacency[c].add(b);
    incidentFaces[a].push(i / 3); incidentFaces[b].push(i / 3); incidentFaces[c].push(i / 3);
  }
  return { vertexCount: count, welded, representatives, faces, neighbours: adjacency.map((n) => [...n]), incidentFaces };
}

class MinHeap {
  items: Array<[number, number]> = [];
  push(vertex: number, distance: number) {
    const item: [number, number] = [vertex, distance];
    let i = this.items.length;
    this.items.push(item);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.items[parent][1] <= distance) break;
      this.items[i] = this.items[parent]; i = parent;
    }
    this.items[i] = item;
  }
  pop(): [number, number] | undefined {
    const first = this.items[0], last = this.items.pop();
    if (!this.items.length || !last) return first;
    let i = 0;
    while (i * 2 + 1 < this.items.length) {
      let child = i * 2 + 1;
      if (child + 1 < this.items.length && this.items[child + 1][1] < this.items[child][1]) child++;
      if (this.items[child][1] >= last[1]) break;
      this.items[i] = this.items[child]; i = child;
    }
    this.items[i] = last;
    return first;
  }
}

interface IntrinsicTriangle {
  faceIndex: number;
  ids: [number, number, number];
  length: number;
  x: number;
  y: number;
}

interface ChartTriangleBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** SAT tests positive-area intersection. A shared edge or vertex is allowed. */
function chartTrianglesOverlap(
  flat: Float64Array,
  a: IntrinsicTriangle,
  b: IntrinsicTriangle,
): boolean {
  for (const triangle of [a, b]) {
    for (let edge = 0; edge < 3; edge++) {
      const from = triangle.ids[edge] * 2, to = triangle.ids[(edge + 1) % 3] * 2;
      const nx = flat[to + 1] - flat[from + 1], ny = flat[from] - flat[to];
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (let corner = 0; corner < 3; corner++) {
        const ai = a.ids[corner] * 2, bi = b.ids[corner] * 2;
        const pa = flat[ai] * nx + flat[ai + 1] * ny;
        const pb = flat[bi] * nx + flat[bi + 1] * ny;
        minA = Math.min(minA, pa); maxA = Math.max(maxA, pa);
        minB = Math.min(minB, pb); maxB = Math.max(maxB, pb);
      }
      // Normalize the tolerance by axis length, so tiny triangles and large
      // triangles use the same world-unit separation tolerance.
      if (Math.min(maxA, maxB) - Math.max(minA, minB) <= 1e-10 * Math.hypot(nx, ny)) return false;
    }
  }
  return true;
}

/**
 * LSCM is locally conformal, but a patch with holes/folds can overlap itself
 * globally. Growing one sheet from the anchor prevents the same piece of ink
 * from printing again across an armpit when the requested design is large.
 * This trims only invalid support; it never changes coordinates or ink size.
 */
function retainSingleChartSheet(
  triangles: IntrinsicTriangle[],
  flat: Float64Array,
  globals: number[],
  distances: Float64Array,
  rootFace: number,
  faceCount: number,
  radius: number,
): Float32Array {
  const faceMask = new Float32Array(faceCount);
  const neighbours = triangles.map(() => [] as number[]);
  const edgeOwners = new Map<string, number[]>();
  const bounds: ChartTriangleBounds[] = [];
  for (let i = 0; i < triangles.length; i++) {
    const { ids } = triangles[i];
    bounds.push({
      minX: Math.min(...ids.map((id) => flat[2 * id])), maxX: Math.max(...ids.map((id) => flat[2 * id])),
      minY: Math.min(...ids.map((id) => flat[2 * id + 1])), maxY: Math.max(...ids.map((id) => flat[2 * id + 1])),
    });
    for (let edge = 0; edge < 3; edge++) {
      const a = ids[edge], b = ids[(edge + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`;
      const owners = edgeOwners.get(key) ?? [];
      for (const other of owners) { neighbours[i].push(other); neighbours[other].push(i); }
      owners.push(i); edgeOwners.set(key, owners);
    }
  }
  const root = triangles.findIndex((triangle) => triangle.faceIndex === rootFace);
  if (root < 0) return faceMask;
  const state = new Uint8Array(triangles.length), heap = new MinHeap();
  const cells = new Map<string, number[]>(), largeTriangles: number[] = [];
  const accepted: number[] = [];
  const cellSize = Math.max(0.01, radius / 24);
  const cellKeys = (box: ChartTriangleBounds): string[] | null => {
    const x0 = Math.floor(box.minX / cellSize), x1 = Math.floor(box.maxX / cellSize);
    const y0 = Math.floor(box.minY / cellSize), y1 = Math.floor(box.maxY / cellSize);
    // A pathological stretched triangle must not allocate an unbounded grid.
    // Compare those few triangles against the accepted list directly instead.
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 1024) return null;
    const keys: string[] = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) keys.push(`${x},${y}`);
    return keys;
  };
  state[root] = 1; heap.push(root, 0);
  while (heap.items.length) {
    const [index] = heap.pop()!;
    const triangle = triangles[index], box = bounds[index];
    const [a, b, c] = triangle.ids;
    const area = (flat[2 * b] - flat[2 * a]) * (flat[2 * c + 1] - flat[2 * a + 1]) -
      (flat[2 * b + 1] - flat[2 * a + 1]) * (flat[2 * c] - flat[2 * a]);
    if (!Number.isFinite(area) || area <= 1e-14) { state[index] = 3; continue; }
    const keys = cellKeys(box);
    const candidates = keys ? new Set([...largeTriangles, ...keys.flatMap((key) => cells.get(key) ?? [])]) : accepted;
    let overlaps = false;
    for (const other of candidates) {
      const otherBox = bounds[other];
      if (box.maxX <= otherBox.minX || otherBox.maxX <= box.minX || box.maxY <= otherBox.minY || otherBox.maxY <= box.minY) continue;
      if (chartTrianglesOverlap(flat, triangle, triangles[other])) { overlaps = true; break; }
    }
    if (overlaps) { state[index] = 3; continue; }
    state[index] = 2;
    faceMask[triangle.faceIndex] = 1;
    accepted.push(index);
    if (keys) for (const key of keys) { const bucket = cells.get(key) ?? []; bucket.push(index); cells.set(key, bucket); }
    else largeTriangles.push(index);
    for (const next of neighbours[index]) {
      if (state[next]) continue;
      state[next] = 1;
      const ids = triangles[next].ids;
      heap.push(next, (distances[globals[ids[0]]] + distances[globals[ids[1]]] + distances[globals[ids[2]]]) / 3);
    }
  }
  return faceMask;
}

/** Solve the sparse normal equations of least-squares conformal mapping. */
function flatten(
  triangles: IntrinsicTriangle[],
  count: number,
  initial: Float64Array,
  pinA: number,
  pinB: number,
): Float64Array | null {
  const dim = count * 2;
  const rows = Array.from({ length: dim }, () => new Map<number, number>());
  const add = (i: number, j: number, value: number) => rows[i].set(j, (rows[i].get(j) ?? 0) + value);
  for (const { ids, length, x, y } of triangles) {
    // Gradients of barycentric coordinates, weighted by sqrt(triangle area).
    const weight = 1 / Math.sqrt(length * y);
    const a = [-y * weight, y * weight, 0];
    const b = [(x - length) * weight, -x * weight, length * weight];
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
      const laplace = a[i] * a[j] + b[i] * b[j];
      const cross = b[i] * a[j] - a[i] * b[j];
      const u = ids[i] * 2, v = ids[j] * 2;
      add(u, v, laplace); add(u + 1, v + 1, laplace);
      add(u, v + 1, cross); add(u + 1, v, -cross);
    }
  }
  const fixed = new Uint8Array(dim);
  fixed[2 * pinA] = fixed[2 * pinA + 1] = fixed[2 * pinB] = fixed[2 * pinB + 1] = 1;
  const rhs = new Float64Array(dim), diagonal = new Float64Array(dim);
  const offsets = new Int32Array(dim + 1), columns: number[] = [], values: number[] = [];
  for (let i = 0; i < dim; i++) {
    offsets[i] = columns.length;
    if (fixed[i]) {
      columns.push(i); values.push(1); rhs[i] = initial[i]; diagonal[i] = 1;
      continue;
    }
    for (const [j, value] of rows[i]) {
      if (fixed[j]) rhs[i] -= value * initial[j];
      else if (Math.abs(value) > 1e-12) { columns.push(j); values.push(value); }
      if (i === j) diagonal[i] = value;
    }
    if (diagonal[i] < 1e-14) return null;
  }
  offsets[dim] = columns.length;
  const col = Int32Array.from(columns), val = Float64Array.from(values);
  const multiply = (input: Float64Array, output: Float64Array) => {
    for (let i = 0; i < dim; i++) {
      let sum = 0;
      for (let j = offsets[i]; j < offsets[i + 1]; j++) sum += val[j] * input[col[j]];
      output[i] = sum;
    }
  };
  const solution = initial.slice(), residual = new Float64Array(dim), direction = new Float64Array(dim), product = new Float64Array(dim);
  multiply(solution, product);
  let rz = 0, rhsNorm = 0;
  for (let i = 0; i < dim; i++) {
    residual[i] = rhs[i] - product[i];
    direction[i] = residual[i] / diagonal[i];
    rz += residual[i] * direction[i];
    rhsNorm += rhs[i] * rhs[i];
  }
  const tolerance = Math.max(1e-18, rhsNorm * 1e-13);
  // The local patch normally converges in <180 iterations. Bound drag latency.
  for (let iteration = 0; iteration < Math.min(350, dim * 2); iteration++) {
    multiply(direction, product);
    let denominator = 0;
    for (let i = 0; i < dim; i++) denominator += direction[i] * product[i];
    if (Math.abs(denominator) < 1e-25 || rz < 1e-25) break;
    const alpha = rz / denominator;
    let nextRz = 0, norm = 0;
    for (let i = 0; i < dim; i++) {
      solution[i] += alpha * direction[i];
      residual[i] -= alpha * product[i];
      nextRz += residual[i] * residual[i] / diagonal[i];
      norm += residual[i] * residual[i];
    }
    if (norm < tolerance) break;
    const beta = nextRz / rz;
    for (let i = 0; i < dim; i++) direction[i] = residual[i] / diagonal[i] + beta * direction[i];
    rz = nextRz;
  }
  return solution.every(Number.isFinite) ? solution : null;
}

function distanceToSegment(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const t = THREE.MathUtils.clamp(-(ax * dx + ay * dy) / Math.max(1e-20, dx * dx + dy * dy), 0, 1);
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function distanceToTriangle(points: Float64Array, ids: [number, number, number]): number {
  const [a, b, c] = ids.map((i) => [points[2 * i], points[2 * i + 1]]);
  const s1 = a[0] * b[1] - a[1] * b[0];
  const s2 = b[0] * c[1] - b[1] * c[0];
  const s3 = c[0] * a[1] - c[1] * a[0];
  if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return 0;
  return Math.min(distanceToSegment(...a as [number, number], ...b as [number, number]), distanceToSegment(...b as [number, number], ...c as [number, number]), distanceToSegment(...c as [number, number], ...a as [number, number]));
}

/**
 * Build a temporary intrinsic UV chart around the chosen skin point. Distances
 * and triangle angles come from the skin itself, not from planar projection.
 * The atlas therefore never determines placement or cuts the artwork.
 */
export function buildSurfaceChart(
  topology: SurfaceTopology,
  geometry: THREE.BufferGeometry,
  matrixWorld: THREE.Matrix4,
  anchor: SurfaceAnchor,
  radius = 0.8,
): SurfaceChart | null {
  if (!validateSurfaceAnchor(anchor, geometry) || topology.vertexCount !== geometry.getAttribute('position').count || !Number.isFinite(radius) || radius <= 0) return null;
  const position = geometry.getAttribute('position');
  const world = topology.representatives.map((i) => new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(matrixWorld));
  const normals = world.map(() => new THREE.Vector3());
  const edge1 = new THREE.Vector3(), edge2 = new THREE.Vector3();
  for (let i = 0; i < topology.faces.length; i += 3) {
    const a = topology.faces[i], b = topology.faces[i + 1], c = topology.faces[i + 2];
    edge1.subVectors(world[b], world[a]); edge2.subVectors(world[c], world[a]); edge1.cross(edge2);
    normals[a].add(edge1); normals[b].add(edge1); normals[c].add(edge1);
  }
  for (const n of normals) n.normalize();
  const rootIds = Array.from(topology.faces.subarray(anchor.faceIndex * 3, anchor.faceIndex * 3 + 3)) as [number, number, number];
  if (new Set(rootIds).size !== 3) return null;
  const origin = new THREE.Vector3(), normal = new THREE.Vector3();
  rootIds.forEach((id, i) => { origin.addScaledVector(world[id], anchor.barycentric[i]); normal.addScaledVector(normals[id], anchor.barycentric[i]); });
  normal.normalize();
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(normal, -normal.y);
  if (up.lengthSq() < 0.02) up.set(0, 0, -1).addScaledVector(normal, normal.z);
  up.normalize();
  const right = new THREE.Vector3().crossVectors(up, normal).normalize();
  up.crossVectors(normal, right).normalize();

  const distances = new Float64Array(world.length).fill(Infinity), heap = new MinHeap();
  for (const id of rootIds) { distances[id] = world[id].distanceTo(origin); heap.push(id, distances[id]); }
  while (heap.items.length) {
    const [id, distance] = heap.pop()!;
    if (distance !== distances[id] || distance > radius) continue;
    for (const neighbour of topology.neighbours[id]) {
      // Do not let a local chart close around a limb. A 120-degree turn
      // allows useful wrapping well past a planar projector's limit while
      // retaining an open strip on the opposite side of the limb.
      if (normals[neighbour].dot(normal) < -0.5 && !rootIds.includes(neighbour)) continue;
      const next = distance + world[id].distanceTo(world[neighbour]);
      if (next < distances[neighbour] && next <= radius) { distances[neighbour] = next; heap.push(neighbour, next); }
    }
  }

  // Retain the triangle-connected component containing the actual hit. Merely
  // touching the patch at a vertex must not put ink on another skin fold.
  const candidate = new Uint8Array(topology.faces.length / 3);
  for (let i = 0; i < candidate.length; i++) {
    const a = topology.faces[3 * i], b = topology.faces[3 * i + 1], c = topology.faces[3 * i + 2];
    if (distances[a] <= radius && distances[b] <= radius && distances[c] <= radius && a !== b && b !== c && a !== c) candidate[i] = 1;
  }
  if (!candidate[anchor.faceIndex]) return null;
  const queue = [anchor.faceIndex], selected = new Uint8Array(candidate.length);
  selected[anchor.faceIndex] = 1;
  for (let q = 0; q < queue.length; q++) {
    const f = queue[q], ids = [topology.faces[3 * f], topology.faces[3 * f + 1], topology.faces[3 * f + 2]];
    for (const vertex of ids) for (const other of topology.incidentFaces[vertex]) {
      if (selected[other] || !candidate[other]) continue;
      let shared = 0;
      for (let k = 0; k < 3; k++) if (ids.includes(topology.faces[3 * other + k])) shared++;
      if (shared >= 2) { selected[other] = 1; queue.push(other); }
    }
  }
  if (queue.length < 2) return null;
  const localOf = new Int32Array(world.length).fill(-1), globals: number[] = [];
  for (const f of queue) for (let k = 0; k < 3; k++) {
    const id = topology.faces[f * 3 + k];
    if (localOf[id] < 0) { localOf[id] = globals.length; globals.push(id); }
  }
  const triangles: IntrinsicTriangle[] = [];
  const edgeCounts = new Map<string, [number, number, number]>();
  for (const f of queue) {
    const raw = [topology.faces[f * 3], topology.faces[f * 3 + 1], topology.faces[f * 3 + 2]];
    const ids = raw.map((id) => localOf[id]) as [number, number, number];
    edge1.subVectors(world[raw[1]], world[raw[0]]); edge2.subVectors(world[raw[2]], world[raw[0]]);
    const length = edge1.length(), x = edge2.dot(edge1) / length;
    const y = Math.sqrt(Math.max(0, edge2.lengthSq() - x * x));
    if (length < 1e-10 || y < 1e-10) continue;
    triangles.push({ faceIndex: f, ids, length, x, y });
    for (let i = 0; i < 3; i++) {
      const a = ids[i], b = ids[(i + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`;
      const record = edgeCounts.get(key);
      if (record) record[2]++; else edgeCounts.set(key, [a, b, 1]);
    }
  }
  const boundary = [...edgeCounts.values()].filter((e) => e[2] === 1);
  const boundaryVertices = [...new Set(boundary.flatMap(([a, b]) => [a, b]))];
  if (boundaryVertices.length < 3) return null;
  let pinA = boundaryVertices[0], pinB = pinA;
  for (const i of boundaryVertices) if (world[globals[i]].distanceToSquared(origin) > world[globals[pinA]].distanceToSquared(origin)) pinA = i;
  for (const i of boundaryVertices) if (world[globals[i]].distanceToSquared(world[globals[pinA]]) > world[globals[pinB]].distanceToSquared(world[globals[pinA]])) pinB = i;
  if (pinA === pinB) return null;
  const pinOrigin = world[globals[pinA]], pinDelta = world[globals[pinB]].clone().sub(pinOrigin);
  const px = pinDelta.dot(right), py = pinDelta.dot(up), projectedLength = Math.hypot(px, py);
  if (projectedLength < 1e-8) return null;
  const initial = new Float64Array(globals.length * 2);
  for (let i = 0; i < globals.length; i++) {
    edge1.subVectors(world[globals[i]], pinOrigin);
    const x = edge1.dot(right), y = edge1.dot(up);
    initial[2 * i] = (x * px + y * py) / projectedLength;
    initial[2 * i + 1] = (-x * py + y * px) / projectedLength;
  }
  const flat = flatten(triangles, globals.length, initial, pinA, pinB);
  if (!flat) return null;
  const root = rootIds.map((id) => localOf[id]) as [number, number, number];
  let ox = 0, oy = 0;
  root.forEach((id, i) => { ox += flat[2 * id] * anchor.barycentric[i]; oy += flat[2 * id + 1] * anchor.barycentric[i]; });
  const rootTri = triangles.find((t) => t.ids[0] === root[0] && t.ids[1] === root[1] && t.ids[2] === root[2]);
  if (!rootTri) return null;
  const [a, b, c] = root;
  const dx1 = flat[2 * b] - flat[2 * a], dy1 = flat[2 * b + 1] - flat[2 * a + 1];
  const dx2 = flat[2 * c] - flat[2 * a], dy2 = flat[2 * c + 1] - flat[2 * a + 1];
  const determinant = dx1 * dy2 - dy1 * dx2;
  if (determinant <= 1e-12) return null;
  const scale = Math.sqrt(rootTri.length * rootTri.y / determinant);
  edge1.subVectors(world[rootIds[1]], world[rootIds[0]]).normalize();
  edge2.subVectors(world[rootIds[2]], world[rootIds[0]]).addScaledVector(edge1, -rootTri.x).normalize();
  const localUpX = up.dot(edge1), localUpY = up.dot(edge2);
  const mappedUpX = dx1 / rootTri.length * localUpX + (dx2 - dx1 * rootTri.x / rootTri.length) / rootTri.y * localUpY;
  const mappedUpY = dy1 / rootTri.length * localUpX + (dy2 - dy1 * rootTri.x / rootTri.length) / rootTri.y * localUpY;
  const angle = Math.PI / 2 - Math.atan2(mappedUpY, mappedUpX), cosine = Math.cos(angle), sine = Math.sin(angle);
  for (let i = 0; i < globals.length; i++) {
    const x = (flat[2 * i] - ox) * scale, y = (flat[2 * i + 1] - oy) * scale;
    flat[2 * i] = x * cosine - y * sine; flat[2 * i + 1] = x * sine + y * cosine;
  }

  // A rotation-independent safe circle keeps every inked pixel well inside
  // the chart. Foldovers or severe local stretching shrink this same bound.
  let safeRadius = radius;
  for (const [a, b] of boundary) safeRadius = Math.min(safeRadius, distanceToSegment(flat[2 * a], flat[2 * a + 1], flat[2 * b], flat[2 * b + 1]));
  for (const t of triangles) {
    const [a, b, c] = t.ids;
    const ux = (flat[2 * b] - flat[2 * a]) / t.length;
    const vx = (flat[2 * b + 1] - flat[2 * a + 1]) / t.length;
    const uy = (flat[2 * c] - flat[2 * a] - ux * t.x) / t.y;
    const vy = (flat[2 * c + 1] - flat[2 * a + 1] - vx * t.x) / t.y;
    const det = ux * vy - uy * vx, trace = ux * ux + uy * uy + vx * vx + vy * vy;
    const discriminant = Math.sqrt(Math.max(0, trace * trace - 4 * det * det));
    const largest = Math.sqrt(Math.max(0, (trace + discriminant) / 2));
    const smallest = Math.sqrt(Math.max(0, (trace - discriminant) / 2));
    if (det <= 0 || smallest < 0.60 || largest > 1.65 || largest / Math.max(1e-10, smallest) > 1.55) {
      safeRadius = Math.min(safeRadius, distanceToTriangle(flat, t.ids));
    }
  }
  const maxSize = safeRadius * Math.SQRT2 * 0.92;
  if (!Number.isFinite(maxSize) || maxSize < 0.025) return null;
  // Match the Float32 coordinates the renderer actually interpolates. Testing
  // the higher precision solve alone can miss tiny overlaps introduced during
  // the GPU attribute conversion.
  const faceMask = retainSingleChartSheet(
    triangles, Float64Array.from(flat, Math.fround), globals, distances,
    anchor.faceIndex, topology.faces.length / 3, radius,
  );
  if (!faceMask[anchor.faceIndex]) return null;
  const uv = new Float32Array(topology.vertexCount * 2), mask = new Float32Array(topology.vertexCount);
  for (let i = 0; i < topology.vertexCount; i++) {
    const local = localOf[topology.welded[i]];
    if (local < 0) continue;
    uv[2 * i] = flat[2 * local]; uv[2 * i + 1] = flat[2 * local + 1]; mask[i] = 1;
  }
  return { uv, mask, faceMask, maxSize, ...(maxSize < 0.18 ? { message: 'A smaller tattoo fits this curved area best.' } : {}) };
}
