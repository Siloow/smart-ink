/** Numeric checks on the real body meshes, plus seam-split analytical surfaces. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import draco3d from 'draco3d';
import * as THREE from 'three';

const output = path.join(os.tmpdir(), `smartink-surface-${process.pid}.mjs`);
await build({ stdin: { contents: "export * from './src/render/surfacePlacement.ts'; export * from './src/render/bodyShape.ts';", resolveDir: process.cwd(), loader: 'ts' }, outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
const { createSurfaceTopology, buildSurfaceChart, validateSurfaceAnchor, prepareDeformable, shapeBounds, applyBodyShape, BODY_SHAPE_KEYS, BODY_SHAPE_PRESETS, shapeFromPreset } = await import(pathToFileURL(output));
await fs.unlink(output);
const identity = new THREE.Matrix4();
const anchor = (faceIndex, barycentric = [1 / 3, 1 / 3, 1 / 3]) => ({ faceIndex, barycentric, bodyMeshId: 'test' });

assert.equal(validateSurfaceAnchor(anchor(-1)), false);
assert.equal(validateSurfaceAnchor(anchor(0, [1, 1, 0])), false);
assert.equal(validateSurfaceAnchor(anchor(0)), true);

function seamCheck(topology, chart) {
  const seen = new Map();
  for (let i = 0; i < topology.vertexCount; i++) {
    const id = topology.welded[i];
    const previous = seen.get(id);
    if (previous !== undefined) {
      assert.equal(chart.uv[i * 2], chart.uv[previous * 2]);
      assert.equal(chart.uv[i * 2 + 1], chart.uv[previous * 2 + 1]);
      assert.equal(chart.mask[i], chart.mask[previous]);
    } else seen.set(id, i);
  }
}

function anchorForHit(geometry, hit) {
  const pos = geometry.getAttribute('position');
  const weights = new THREE.Triangle(...[hit.face.a, hit.face.b, hit.face.c].map((i) => new THREE.Vector3().fromBufferAttribute(pos, i))).getBarycoord(hit.point, new THREE.Vector3());
  return anchor(hit.faceIndex, weights.toArray());
}

function chartAtHit(chart, geometry, hit) {
  const a = anchorForHit(geometry, hit);
  return [0, 1].map((axis) => [hit.face.a, hit.face.b, hit.face.c].reduce((sum, id, i) => sum + chart.uv[id * 2 + axis] * a.barycentric[i], 0));
}

function anchorPoint(geometry, savedAnchor) {
  const position = geometry.getAttribute('position');
  return savedAnchor.barycentric.reduce((point, weight, corner) => {
    const id = geometry.index.getX(savedAnchor.faceIndex * 3 + corner);
    return point.addScaledVector(new THREE.Vector3().fromBufferAttribute(position, id), weight);
  }, new THREE.Vector3());
}

function shapeRegression(geometry, topology, mesh, sex) {
  const origins = [[0, 1.06, 3], [sex === 'male' ? 0.81 : 0.70, 0.40, 3]];
  const shapes = [
    { id: 'all sliders minimum', values: Object.fromEntries(BODY_SHAPE_KEYS.map((key) => [key, -1])) },
    { id: 'all sliders maximum', values: Object.fromEntries(BODY_SHAPE_KEYS.map((key) => [key, 1])) },
    ...BODY_SHAPE_PRESETS,
  ];
  for (const origin of origins) {
    const hit = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(0, 0, -1)).intersectObject(mesh)[0];
    assert.ok(hit, `${sex} saved anchor ray`);
    const savedAnchor = { ...anchorForHit(geometry, hit), bodyMeshId: `body_${sex}` };
    const chart = buildSurfaceChart(topology, geometry, identity, savedAnchor);
    assert.ok(chart);
    const restored = JSON.parse(JSON.stringify(savedAnchor));
    assert.ok(validateSurfaceAnchor(restored, geometry), `${sex} restored anchor validates`);
    const rebuilt = buildSurfaceChart(topology, geometry, identity, restored);
    assert.ok(rebuilt);
    assert.deepEqual(rebuilt.uv, chart.uv, `${sex} restored UV chart is bit-identical`);
    assert.deepEqual(rebuilt.mask, chart.mask, `${sex} restored mask is bit-identical`);
    assert.deepEqual(rebuilt.faceMask, chart.faceMask, `${sex} restored face mask is bit-identical`);
    assert.equal(rebuilt.maxSize, chart.maxSize, `${sex} restored safe size is identical`);

    const deformed = geometry.clone();
    const tattooUV = new THREE.BufferAttribute(chart.uv.slice(), 2);
    const tattooMask = new THREE.BufferAttribute(chart.mask.slice(), 1);
    deformed.setAttribute('aTattooUv', tattooUV);
    deformed.setAttribute('aTattooMask', tattooMask);
    const prepared = prepareDeformable(deformed), bounds = shapeBounds([prepared]);
    const undeformedAnchor = anchorPoint(deformed, restored);
    for (const preset of shapes) {
      applyBodyShape([prepared], bounds, shapeFromPreset(preset));
      assert.equal(deformed.getAttribute('aTattooUv'), tattooUV, `${sex} ${preset.id}: chart attribute retained`);
      assert.equal(deformed.getAttribute('aTattooMask'), tattooMask, `${sex} ${preset.id}: mask attribute retained`);
      assert.deepEqual(tattooUV.array, chart.uv, `${sex} ${preset.id}: skin UV coordinates unchanged`);
      assert.deepEqual(tattooMask.array, chart.mask, `${sex} ${preset.id}: tattoo support unchanged`);
      const pos = deformed.getAttribute('position');
      for (let i = 0; i < topology.vertexCount; i++) {
        const representative = topology.representatives[topology.welded[i]];
        assert.ok(Math.hypot(pos.getX(i) - pos.getX(representative), pos.getY(i) - pos.getY(representative), pos.getZ(i) - pos.getZ(representative)) < 1e-6, `${sex} ${preset.id}: duplicated seam vertices stay coincident`);
      }
      const attachedPoint = anchorPoint(deformed, restored);
      if (preset.id.startsWith('all sliders')) assert.ok(attachedPoint.distanceTo(undeformedAnchor) > 0.01, `${sex} ${preset.id}: anchor moves with the skin`);
      const ids = [0, 1, 2].map((corner) => deformed.index.getX(restored.faceIndex * 3 + corner));
      const triangle = new THREE.Triangle(...ids.map((id) => new THREE.Vector3().fromBufferAttribute(pos, id)));
      const weights = triangle.getBarycoord(attachedPoint, new THREE.Vector3());
      assert.ok(weights && weights.toArray().every((weight, i) => Math.abs(weight - restored.barycentric[i]) < 1e-5), `${sex} ${preset.id}: anchor remains on its same skin triangle`);
      const tattooAtAnchor = [0, 1].map((axis) => ids.reduce((sum, id, i) => sum + tattooUV.array[id * 2 + axis] * weights.getComponent(i), 0));
      assert.ok(Math.hypot(...tattooAtAnchor) < 1e-6, `${sex} ${preset.id}: tattoo remains centered at the moving anchor`);
    }
    // Resetting is another slider action and must exactly restore source positions.
    applyBodyShape([prepared], bounds, shapeFromPreset(BODY_SHAPE_PRESETS[0]));
    assert.deepEqual(deformed.getAttribute('position').array, geometry.getAttribute('position').array, `${sex} reset restores source body exactly`);
    deformed.dispose();
  }
  console.log(`${sex} saved-anchor roundtrip and ${shapes.length} body shapes ×2 placements passed.`);
}

/** Every point of each supported rectangular footprint must remain on skin. */
function footprintCheck(geometry, chart, label) {
  const triangles = [];
  for (let f = 0; f < geometry.index.count; f += 3) {
    if (chart.faceMask[f / 3] !== 1) continue;
    const ids = [0, 1, 2].map((k) => geometry.index.getX(f + k));
    if (ids.some((i) => chart.mask[i] !== 1)) continue;
    const [a, b, c] = ids.map((i) => [chart.uv[i * 2], chart.uv[i * 2 + 1]]);
    triangles.push({ a, b, c, minX: Math.min(a[0], b[0], c[0]), maxX: Math.max(a[0], b[0], c[0]), minY: Math.min(a[1], b[1], c[1]), maxY: Math.max(a[1], b[1], c[1]) });
  }
  const covered = (x, y) => triangles.some(({ a, b, c, minX, minY, maxX, maxY }) => {
    if (x < minX - 1e-7 || x > maxX + 1e-7 || y < minY - 1e-7 || y > maxY + 1e-7) return false;
    const cross = (p, q) => (q[0] - p[0]) * (y - p[1]) - (q[1] - p[1]) * (x - p[0]);
    const signs = [cross(a, b), cross(b, c), cross(c, a)];
    return signs.every((v) => v >= -1e-8) || signs.every((v) => v <= 1e-8);
  });
  for (const aspect of [1 / 3, 1, 3]) for (const degrees of [0, 45, 90, 180]) {
    const ratio = Math.min(aspect, 1 / aspect);
    const longSide = chart.maxSize * Math.SQRT2 / Math.hypot(1, ratio) * 0.999;
    const width = aspect >= 1 ? longSide : longSide * aspect;
    const height = aspect >= 1 ? longSide / aspect : longSide;
    const angle = degrees * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle);
    for (let ix = -3; ix <= 3; ix++) for (let iy = -3; iy <= 3; iy++) {
      const x = width / 2 * ix / 3, y = height / 2 * iy / 3;
      assert.ok(covered(x * cos - y * sin, x * sin + y * cos), `${label}: ${aspect}:1 at ${degrees}° sample ${ix},${iy} must fit the chart`);
    }
  }
}

/** Large fixed-size designs must never reuse an artwork pixel on another sheet. */
function nonOverlapRegression(geometry, topology, mesh, sex) {
  const cases = [
    { name: 'outer shoulder beside armpit', origin: [5, 1.071, 0], direction: [-1, 0, 0] },
    { name: 'front shoulder', origin: [sex === 'male' ? 0.48 : 0.46, 1.2, 3], direction: [0, 0, -1] },
  ];
  for (const { name, origin, direction } of cases) {
    const hit = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction)).intersectObject(mesh)[0];
    assert.ok(hit, `${sex} ${name}: regression ray`);
    const chart = buildSurfaceChart(topology, geometry, identity, anchorForHit(geometry, hit));
    assert.ok(chart, `${sex} ${name}: regression chart`);
    assert.equal(chart.faceMask[hit.faceIndex], 1, `${sex} ${name}: anchor triangle retained`);
    assert.equal(chart.faceMask.length, geometry.index.count / 3, 'face mask retains original face order');
    const triangles = [], buckets = new Map();
    const cell = 1.26 / 48;
    const edgeOwners = new Map(), neighbours = new Map();
    for (let f = 0; f < chart.faceMask.length; f++) {
      if (!chart.faceMask[f]) continue;
      const ids = [0, 1, 2].map((corner) => geometry.index.getX(f * 3 + corner));
      const points = ids.map((id) => [chart.uv[id * 2], chart.uv[id * 2 + 1]]);
      const [a, b, c] = points;
      const determinant = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      assert.ok(determinant > 0, `${sex} ${name}: no reversed accepted face`);
      const triangleIndex = triangles.length;
      triangles.push({ points, determinant });
      const minX = Math.max(-0.631, Math.min(...points.map((p) => p[0]))), maxX = Math.min(0.631, Math.max(...points.map((p) => p[0])));
      const minY = Math.max(-0.631, Math.min(...points.map((p) => p[1]))), maxY = Math.min(0.631, Math.max(...points.map((p) => p[1])));
      for (let x = Math.floor(minX / cell); x <= Math.floor(maxX / cell); x++) for (let y = Math.floor(minY / cell); y <= Math.floor(maxY / cell); y++) {
        const key = `${x},${y}`, list = buckets.get(key) ?? []; list.push(triangleIndex); buckets.set(key, list);
      }
      neighbours.set(f, []);
      const welded = ids.map((id) => topology.welded[id]);
      for (let edge = 0; edge < 3; edge++) {
        const a = welded[edge], b = welded[(edge + 1) % 3], key = a < b ? `${a},${b}` : `${b},${a}`;
        const owners = edgeOwners.get(key) ?? [];
        for (const other of owners) { neighbours.get(f).push(other); neighbours.get(other).push(f); }
        owners.push(f); edgeOwners.set(key, owners);
      }
    }
    const connected = new Set([hit.faceIndex]), pending = [hit.faceIndex];
    for (let i = 0; i < pending.length; i++) for (const face of neighbours.get(pending[i])) if (!connected.has(face)) { connected.add(face); pending.push(face); }
    assert.equal(connected.size, triangles.length, `${sex} ${name}: every accepted face connects to the anchor`);
    for (const size of [0.42, 0.8, 1.26]) {
      let covered = 0;
      for (let ix = 0; ix < 96; ix++) for (let iy = 0; iy < 96; iy++) {
        const x = ((ix + 0.371) / 96 - 0.5) * size, y = ((iy + 0.619) / 96 - 0.5) * size;
        let coverage = 0;
        for (const index of buckets.get(`${Math.floor(x / cell)},${Math.floor(y / cell)}`) ?? []) {
          const { points: [a, b, c], determinant } = triangles[index];
          const s = ((x - a[0]) * (c[1] - a[1]) - (y - a[1]) * (c[0] - a[0])) / determinant;
          const t = ((b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0])) / determinant;
          if (s > 1e-8 && t > 1e-8 && s + t < 1 - 1e-8) coverage++;
        }
        assert.ok(coverage <= 1, `${sex} ${name}: ${size} fixed-size artwork pixel printed ${coverage} times at ${x},${y}`);
        if (coverage) covered++;
      }
      assert.ok(covered > 30, `${sex} ${name}: fixed ${size} design retains a useful chart`);
    }
  }
  console.log(`${sex}: fixed-size shoulder/armpit designs have no duplicate UV coverage and remain anchor-connected.`);
}

function testSurface(name, geometry, point, radius = 0.8) {
  // toNonIndexed deliberately duplicates every vertex, a harder seam case
  // than the body atlas. The chart must still be one continuous surface.
  const geo = geometry.toNonIndexed();
  const topology = createSurfaceTopology(geo);
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const ray = new THREE.Raycaster(point.clone().multiplyScalar(2), point.clone().negate().normalize());
  const hit = ray.intersectObject(mesh)[0];
  assert.ok(hit, `${name}: ray hit`);
  const started = performance.now();
  const chart = buildSurfaceChart(topology, geo, identity, anchor(hit.faceIndex), radius);
  assert.ok(chart, `${name}: valid chart`);
  seamCheck(topology, chart);
  assert.ok(chart.maxSize > 0.1 && chart.maxSize < 1.5, `${name}: sensible size ${chart.maxSize}`);
  console.log(`${name}: maxSize ${chart.maxSize.toFixed(3)}, ${(performance.now() - started).toFixed(1)} ms`);
  return chart;
}

testSurface('plane with every edge split', new THREE.PlaneGeometry(3, 3, 50, 50), new THREE.Vector3(0, 0, 1));
testSurface('cylinder seam and curvature', new THREE.CylinderGeometry(0.22, 0.22, 2, 64, 30, true), new THREE.Vector3(0, 0, 0.22));
testSurface('sphere curved shoulder', new THREE.SphereGeometry(0.45, 40, 32), new THREE.Vector3(0, 0, 0.45));

// A surface millimetres behind the intended patch must not get a second copy.
const splitPlane = new THREE.PlaneGeometry(2, 2, 15, 15).toNonIndexed();
const first = splitPlane.getAttribute('position').array;
const joined = new Float32Array(first.length * 2); joined.set(first); joined.set(first, first.length);
for (let i = first.length + 2; i < joined.length; i += 3) joined[i] -= 0.015;
const disconnected = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(joined, 3));
const disconnectedTopology = createSurfaceTopology(disconnected);
const disconnectedMesh = new THREE.Mesh(disconnected, new THREE.MeshBasicMaterial());
const frontHit = new THREE.Raycaster(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)).intersectObject(disconnectedMesh)[0];
const disconnectedChart = buildSurfaceChart(disconnectedTopology, disconnected, identity, anchorForHit(disconnected, frontHit));
assert.ok(disconnectedChart);
assert.ok(disconnectedChart.mask.subarray(first.length / 3).every((v) => v === 0), 'nearby disconnected skin stays clean');
for (const bad of [null, {}, anchor(-1), anchor(1e9), anchor(0, [NaN, 0, 1]), anchor(0, [1, 1, 0])]) {
  assert.equal(buildSurfaceChart(disconnectedTopology, disconnected, identity, bad), null, 'malformed anchor is rejected');
}

const decoderModule = await draco3d.createDecoderModule({});
async function loadBody(filename) {
  const buffer = await fs.readFile(filename);
  const jsonLength = buffer.readUInt32LE(12);
  const gltf = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString());
  const binaryOffset = 20 + jsonLength + 8;
  let best;
  for (let meshIndex = 0; meshIndex < gltf.meshes.length; meshIndex++) {
    const primitive = gltf.meshes[meshIndex].primitives[0];
    const count = gltf.accessors[primitive.attributes.POSITION].count;
    if (!best || count > best.count) best = { meshIndex, primitive, count };
  }
  const ext = best.primitive.extensions.KHR_draco_mesh_compression;
  const view = gltf.bufferViews[ext.bufferView];
  const bytes = buffer.subarray(binaryOffset + (view.byteOffset ?? 0), binaryOffset + (view.byteOffset ?? 0) + view.byteLength);
  const decoder = new decoderModule.Decoder(), input = new decoderModule.DecoderBuffer(), mesh = new decoderModule.Mesh();
  input.Init(new Int8Array(bytes), bytes.length);
  assert.ok(decoder.DecodeBufferToMesh(input, mesh).ok());
  const geometry = new THREE.BufferGeometry();
  for (const [semantic, name, itemSize] of [['POSITION', 'position', 3], ['NORMAL', 'normal', 3], ['TEXCOORD_0', 'uv', 2]]) {
    if (ext.attributes[semantic] === undefined) continue;
    const attribute = decoder.GetAttributeByUniqueId(mesh, ext.attributes[semantic]);
    const array = new decoderModule.DracoFloat32Array();
    decoder.GetAttributeFloatForAllPoints(mesh, attribute, array);
    const values = Float32Array.from({ length: mesh.num_points() * itemSize }, (_, i) => array.GetValue(i));
    geometry.setAttribute(name, new THREE.BufferAttribute(values, itemSize));
    decoderModule.destroy(array);
  }
  const indices = new Uint32Array(mesh.num_faces() * 3), face = new decoderModule.DracoInt32Array();
  for (let f = 0; f < mesh.num_faces(); f++) { decoder.GetFaceFromMesh(mesh, f, face); for (let k = 0; k < 3; k++) indices[f * 3 + k] = face.GetValue(k); }
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  for (const item of [face, input, mesh, decoder]) decoderModule.destroy(item);
  const nodes = gltf.nodes.map((n) => {
    const obj = new THREE.Object3D();
    if (n.matrix) { obj.matrix.fromArray(n.matrix); obj.matrix.decompose(obj.position, obj.quaternion, obj.scale); }
    else { if (n.translation) obj.position.fromArray(n.translation); if (n.rotation) obj.quaternion.fromArray(n.rotation); if (n.scale) obj.scale.fromArray(n.scale); }
    return obj;
  });
  gltf.nodes.forEach((n, i) => (n.children ?? []).forEach((j) => nodes[i].add(nodes[j])));
  const node = nodes[gltf.nodes.findIndex((n) => n.mesh === best.meshIndex)];
  node.updateWorldMatrix(true, false);
  geometry.applyMatrix4(node.matrixWorld);
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  geometry.translate(-center.x, -center.y, -center.z); geometry.scale(4.2 / size.y, 4.2 / size.y, 4.2 / size.y);
  geometry.computeBoundingBox(); geometry.computeVertexNormals();
  return geometry;
}

const commonRegions = [
  ['sternum seam', [0, 1.06, 3], [0, 0, -1]],
  ['abdomen seam', [0, 0.35, 3], [0, 0, -1]],
  ['back seam', [0, 0.75, -3], [0, 0, 1]],
  ['thigh', [0.25, -0.5, 3], [0, 0, -1]],
  ['side ribs', [0.50, 0.50, 0.03], [-1, 0, 0]],
];

for (const sex of ['male', 'female']) {
  const geometry = await loadBody(`public/models/body_${sex}_realistic.glb`);
  const topology = createSurfaceTopology(geometry);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  console.log(`${sex}: ${topology.vertexCount} render vertices → ${topology.representatives.length} skin vertices`);
  const outputCases = [];
  const regions = [...commonRegions,
    ['shoulder', [sex === 'male' ? 0.48 : 0.46, 1.20, 3], [0, 0, -1]],
    ['upper arm', [sex === 'male' ? 0.64 : 0.54, 0.80, 3], [0, 0, -1]],
    ['forearm', [sex === 'male' ? 0.81 : 0.70, 0.40, 3], [0, 0, -1]],
    ['knee', [sex === 'male' ? 0.365 : 0.29, -1.05, 3], [0, 0, -1]],
    ['calf', [sex === 'male' ? 0.39 : 0.31, -1.45, -3], [0, 0, 1]],
    ['foot', [sex === 'male' ? 0.42 : 0.31, -1.98, 3], [0, 0, -1]],
  ];
  for (const [name, origin, direction] of regions) {
    const hit = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction)).intersectObject(mesh)[0];
    assert.ok(hit, `${sex} ${name}: anatomical ray must hit skin`);
    const started = performance.now();
    const chart = buildSurfaceChart(topology, geometry, identity, anchorForHit(geometry, hit));
    const elapsed = performance.now() - started;
    console.log(`${sex} ${name}: ${chart ? `maxSize ${chart.maxSize.toFixed(3)}` : 'restricted'}, ${elapsed.toFixed(1)} ms`);
    if (chart) {
      seamCheck(topology, chart);
      assert.ok([...chart.uv].every(Number.isFinite));
      const center = chartAtHit(chart, geometry, hit);
      assert.ok(Math.hypot(...center) < 1e-6, `${sex} ${name}: anchor stays centred`);
      footprintCheck(geometry, chart, `${sex} ${name}`);
      outputCases.push({ name, maxSize: chart.maxSize, ms: elapsed });
    }
    if (name !== 'foot') assert.ok(chart, `${sex} ${name} must allow placement`);
  }
  assert.ok(outputCases.length >= 10, `${sex} coverage`);
  let previous, crossedSeam = false;
  for (let step = -4; step <= 4; step++) {
    const x = step * 0.03;
    const hit = new THREE.Raycaster(new THREE.Vector3(x, 1.06, 3), new THREE.Vector3(0, 0, -1)).intersectObject(mesh)[0];
    assert.ok(hit, `${sex} drag ray`);
    const chart = buildSurfaceChart(topology, geometry, identity, anchorForHit(geometry, hit));
    assert.ok(chart, `${sex} drag chart at ${x}`);
    const neighbour = new THREE.Raycaster(new THREE.Vector3(x + 0.02, 1.06, 3), new THREE.Vector3(0, 0, -1)).intersectObject(mesh)[0];
    const [ux, uy] = chartAtHit(chart, geometry, neighbour);
    assert.ok(ux > 0 && Math.abs(Math.atan2(uy, ux)) < Math.PI / 5, `${sex} no orientation flip across sternum at ${x}`);
    if (previous) {
      const ratio = chart.maxSize / previous.size;
      assert.ok(ratio > 0.60 && ratio < 1.67, `${sex} no sudden size collapse across sternum at ${x}: ${ratio}`);
      if (hit.uv.distanceTo(previous.uv) > 0.05) crossedSeam = true;
    }
    previous = { size: chart.maxSize, uv: hit.uv };
  }
  assert.ok(crossedSeam, `${sex}: drag path actually crossed a UV atlas seam`);
  shapeRegression(geometry, topology, mesh, sex);
  nonOverlapRegression(geometry, topology, mesh, sex);
  if (process.argv.includes('--sweep')) {
    const stats = { accepted: 0, restricted: 0, sizes: [], times: [] };
    for (const direction of [-1, 1]) for (let y = -2; y <= 2; y += 0.2) for (let x = -1.1; x <= 1.1; x += 0.14) {
      const hit = new THREE.Raycaster(new THREE.Vector3(x, y, direction * -3), new THREE.Vector3(0, 0, direction)).intersectObject(mesh)[0];
      if (!hit) continue; // This dense screen grid deliberately includes empty background.
      const started = performance.now();
      const chart = buildSurfaceChart(topology, geometry, identity, anchorForHit(geometry, hit));
      stats.times.push(performance.now() - started);
      if (!chart) { stats.restricted++; continue; }
      stats.accepted++; stats.sizes.push(chart.maxSize);
      assert.ok(chart.maxSize >= 0.025 && Number.isFinite(chart.maxSize));
      assert.ok(chart.uv.every(Number.isFinite));
      assert.ok(Math.hypot(...chartAtHit(chart, geometry, hit)) < 1e-6);
      seamCheck(topology, chart);
      if (stats.accepted % 20 === 0) footprintCheck(geometry, chart, `${sex} sweep ${x.toFixed(2)},${y.toFixed(2)}`);
    }
    stats.times.sort((a, b) => a - b); stats.sizes.sort((a, b) => a - b);
    console.log(`${sex} dense sweep: ${stats.accepted} accepted / ${stats.restricted} restricted, median size ${stats.sizes[Math.floor(stats.sizes.length / 2)].toFixed(3)}, p95 ${stats.times[Math.floor(stats.times.length * 0.95)].toFixed(1)} ms, max ${stats.times.at(-1).toFixed(1)} ms`);
    assert.ok(stats.accepted > 100, `${sex} dense sweep covers the body`);
    assert.ok(stats.restricted / (stats.accepted + stats.restricted) < 0.15, `${sex} restrictions stay local`);
  }
}
console.log('Surface placement checks passed.');
