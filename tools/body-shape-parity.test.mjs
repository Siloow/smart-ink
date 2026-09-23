/** Actual browser/Python deformation parity on both shipped Draco GLBs.
 * Run: node tools/body-shape-parity.test.mjs
 * Optional native Blender cage comparison: --blender-report reports/body-shape/blender
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import draco3d from 'draco3d';
import * as THREE from 'three';

const root = fileURLToPath(new URL('../', import.meta.url));
const nativeArg = process.argv.indexOf('--blender-report');
const nativeDir = nativeArg >= 0 ? path.resolve(process.argv[nativeArg + 1]) : null;
const probeOnly = process.argv.includes('--probe-only');
const decoderModule = await draco3d.createDecoderModule({});
async function loadBody(filename, normalize = true) {
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
  const geometry = new THREE.BufferGeometry();
  try {
    input.Init(new Int8Array(bytes), bytes.length);
    assert.ok(decoder.DecodeBufferToMesh(input, mesh).ok(), `${filename}: Draco decode`);
    for (const [semantic, name, itemSize] of [['POSITION', 'position', 3], ['NORMAL', 'normal', 3], ['TEXCOORD_0', 'uv', 2], ['TANGENT', 'tangent', 4]]) {
      if (ext.attributes[semantic] === undefined) continue;
      const attribute = decoder.GetAttributeByUniqueId(mesh, ext.attributes[semantic]);
      const values = new decoderModule.DracoFloat32Array();
      try {
        decoder.GetAttributeFloatForAllPoints(mesh, attribute, values);
        geometry.setAttribute(name, new THREE.BufferAttribute(Float32Array.from({ length: mesh.num_points() * itemSize }, (_, i) => values.GetValue(i)), itemSize));
      } finally { decoderModule.destroy(values); }
    }
    const indices = new Uint32Array(mesh.num_faces() * 3), face = new decoderModule.DracoInt32Array();
    try {
      for (let f = 0; f < mesh.num_faces(); f++) {
        decoder.GetFaceFromMesh(mesh, f, face);
        for (let k = 0; k < 3; k++) indices[f * 3 + k] = face.GetValue(k);
      }
      geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    } finally { decoderModule.destroy(face); }
  } finally {
    for (const item of [input, mesh, decoder]) decoderModule.destroy(item);
  }
  const nodes = gltf.nodes.map((node) => {
    const object = new THREE.Object3D();
    if (node.matrix) {
      object.matrix.fromArray(node.matrix);
      object.matrix.decompose(object.position, object.quaternion, object.scale);
    } else {
      if (node.translation) object.position.fromArray(node.translation);
      if (node.rotation) object.quaternion.fromArray(node.rotation);
      if (node.scale) object.scale.fromArray(node.scale);
    }
    return object;
  });
  gltf.nodes.forEach((node, i) => (node.children ?? []).forEach((j) => nodes[i].add(nodes[j])));
  const node = nodes[gltf.nodes.findIndex((candidate) => candidate.mesh === best.meshIndex)];
  node.updateWorldMatrix(true, false);
  geometry.applyMatrix4(node.matrixWorld);
  geometry.computeBoundingBox();
  const size = geometry.boundingBox.getSize(new THREE.Vector3());
  const center = geometry.boundingBox.getCenter(new THREE.Vector3());
  if (normalize) {
    geometry.translate(-center.x, -center.y, -center.z);
    geometry.scale(4.2 / size.y, 4.2 / size.y, 4.2 / size.y);
  }
  return geometry;
}


function normalizedPositions(array) {
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < array.length; i += 3) {
    for (let k = 0; k < 3; k++) { minimum[k] = Math.min(minimum[k], array[i + k]); maximum[k] = Math.max(maximum[k], array[i + k]); }
  }
  const height = maximum[1] - minimum[1], center = minimum.map((value, k) => (value + maximum[k]) / 2);
  return { values: Array.from(array, (value, i) => (value - center[i % 3]) / height), bounds: [minimum, maximum] };
}

function compareCage(glb, native) {
  const source = normalizedPositions(glb.getAttribute('position').array);
  const target = normalizedPositions(native.position);
  // Draco quantizes mesh positions. Nearby bins retain seam-duplicate matches.
  const tolerance = 0.0003, bins = new Map();
  for (let i = 0; i < target.values.length; i += 3) {
    const key = target.values.slice(i, i + 3).map((v) => Math.floor(v / tolerance)).join(',');
    if (!bins.has(key)) bins.set(key, []);
    bins.get(key).push(i);
  }
  let maximum = 0, squared = 0;
  for (let i = 0; i < source.values.length; i += 3) {
    const p = source.values.slice(i, i + 3), bin = p.map((v) => Math.floor(v / tolerance));
    let nearest = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const j of bins.get(`${bin[0] + dx},${bin[1] + dy},${bin[2] + dz}`) ?? []) {
        nearest = Math.min(nearest, Math.hypot(...p.map((v, axis) => v - target.values[j + axis])));
      }
    }
    maximum = Math.max(maximum, nearest); squared += nearest * nearest;
  }
  assert.ok(maximum < tolerance, `GLB/cage correspondence within Draco precision: ${maximum}`);
  return { glbVertices: source.values.length / 3, blenderVertices: target.values.length / 3,
    glbBounds: source.bounds, blenderBounds: target.bounds, maxNormalizedDistance: maximum,
    rmsNormalizedDistance: Math.sqrt(squared / (source.values.length / 3)) };
}

const models = [];
for (const sex of ['male', 'female']) {
  const geometry = await loadBody(path.join(root, 'public/models', `body_${sex}_realistic.glb`), false);
  models.push({ sex, geometry });
  if (nativeDir) {
    const native = JSON.parse(await fs.readFile(path.join(nativeDir, `${sex}-cage.json`), 'utf8'));
    models.at(-1).native = native;
    console.log(`${sex} cage correspondence: ${JSON.stringify(compareCage(geometry, native))}`);
  }
}
if (probeOnly) process.exit(0);

const bundled = await build({
  entryPoints: [path.join(root, 'src/render/bodyShape.ts')], bundle: true, platform: 'node', format: 'esm', write: false,
});
const shapeModule = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const { prepareDeformable, shapeBounds, applyBodyShape, BODY_SHAPE_KEYS, BODY_SHAPE_PRESETS, BODY_SHAPE_TUNING, normalizeShape } = shapeModule;
const cases = [
  { name: 'default', shape: {} },
  ...BODY_SHAPE_KEYS.flatMap((key) => [-1, 1].map((value) => ({ name: `${key}${value < 0 ? '-min' : '-max'}`, shape: { [key]: value } }))),
  ...BODY_SHAPE_PRESETS.filter((preset) => preset.id !== 'default').map((preset) => ({ name: preset.id, shape: preset.values })),
  { name: 'all-min', shape: Object.fromEntries(BODY_SHAPE_KEYS.map((key) => [key, -1])) },
  { name: 'all-max', shape: Object.fromEntries(BODY_SHAPE_KEYS.map((key) => [key, 1])) },
  { name: 'clamped-and-invalid', shape: { arms: -2, build: 3, chest: '1', waist: true, head: null, ignored: 1 } },
];
for (const { sex, geometry, native } of models) {
  const base = geometry.getAttribute('position').array.slice();
  const deformable = prepareDeformable(geometry), bounds = shapeBounds([deformable]);
  const python = spawnSync(process.env.PYTHON ?? 'python3', [path.join(root, 'tools/body-shape-parity.py')], {
    input: JSON.stringify({ positions: Array.from(base), cases }), encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(python.status, 0, python.stderr || python.error?.message);
  const expected = JSON.parse(python.stdout);
  assert.deepEqual(expected.tuning, BODY_SHAPE_TUNING, 'Browser and Blender tuning must stay synchronized');
  let worst = 0;
  for (let test = 0; test < cases.length; test++) {
    applyBodyShape([deformable], bounds, normalizeShape(cases[test].shape));
    const actual = geometry.getAttribute('position').array, reference = expected.cases[test].position;
    let difference = 0;
    for (let i = 0; i < actual.length; i++) {
      assert.ok(Number.isFinite(actual[i]) && Number.isFinite(reference[i]), `${sex} ${cases[test].name}: finite positions`);
      difference = Math.max(difference, Math.abs(actual[i] - Math.fround(reference[i])));
    }
    assert.ok(difference <= 0.000001, `${sex} ${cases[test].name}: browser/Python delta ${difference}`);
    worst = Math.max(worst, difference);
  }
  applyBodyShape([deformable], bounds, normalizeShape());
  assert.deepEqual(geometry.getAttribute('position').array, base, `${sex}: returning to default exactly restores originals`);
  console.log(`${sex}: ${cases.length} shapes × ${base.length / 3} vertices, browser/Python maximum delta ${worst}.`);
  const transformed = geometry.clone().scale(2.7, 2.7, 2.7).translate(3, -8, 0.5);
  const transformedBody = prepareDeformable(transformed), transformedBounds = shapeBounds([transformedBody]);
  const mixed = normalizeShape({ arms: -0.7, build: 0.6, legs: 0.3, belly: 0.8, shoulders: 0.3, legLength: -0.2 });
  applyBodyShape([deformable], bounds, mixed);
  applyBodyShape([transformedBody], transformedBounds, mixed);
  const rawResult = geometry.getAttribute('position').array, movedResult = transformed.getAttribute('position').array;
  let equivariance = 0;
  for (let i = 0; i < rawResult.length; i++) {
    equivariance = Math.max(equivariance, Math.abs(rawResult[i] - (movedResult[i] - [3, -8, 0.5][i % 3]) / 2.7));
  }
  assert.ok(equivariance < 0.000003, `${sex}: scale/translation invariance delta ${equivariance}`);
  transformed.dispose();
  if (native?.cases?.length) {
    const cage = new THREE.BufferGeometry();
    cage.setAttribute('position', new THREE.Float32BufferAttribute(native.position, 3));
    cage.setIndex(native.indices);
    const body = prepareDeformable(cage), cageBounds = shapeBounds([body]);
    let nativeDifference = 0;
    for (const test of native.cases) {
      applyBodyShape([body], cageBounds, normalizeShape(test.shape));
      const result = cage.getAttribute('position').array;
      for (let i = 0; i < result.length; i++) nativeDifference = Math.max(nativeDifference, Math.abs(result[i] - test.position[i]));
    }
    assert.ok(nativeDifference < 0.000001, `${sex}: actual Blender axis wrapper vs browser delta ${nativeDifference}`);
    console.log(`${sex}: native Blender ${native.cases.length} cases × ${native.vertices} vertices, maximum delta ${nativeDifference}.`);
    cage.dispose();
  }
  geometry.dispose();
}
console.log('Body shape parity passed: actual browser code and production Python helper agree.');
