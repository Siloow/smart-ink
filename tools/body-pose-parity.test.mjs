/** Run node tools/body-pose-parity.test.mjs. Real Draco meshes, actual TS + Python pose math. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import draco3d from 'draco3d';
import * as THREE from 'three';
const root = fileURLToPath(new URL('../', import.meta.url));
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
const bundled = await build({
  stdin: { contents: "export * from './src/render/bodyPose.ts'; export * from './src/render/bodyShape.ts'; export * from './src/render/bodyRegions.ts';", resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const mod = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const { BODY_POSE_KEYS, BODY_POSE_BOUNDS, BODY_POSE_PRESETS, normalizePose, poseFromPreset,
  prepareDeformable, shapeBounds, applyBodyShape, normalizeShape, applyBodyPose, classifyRegion } = mod;
const cases = [
  ...BODY_POSE_PRESETS.map((preset) => ({ name: preset.id, preset: preset.id })),
  { name: 'legacy-arm-extended', preset: 'arm_extended' },
  ...BODY_POSE_KEYS.flatMap((key) => ['min', 'max'].map((limit) => ({ name: `${key}-${limit}`, pose: { [key]: BODY_POSE_BOUNDS[key][limit] } }))),
  { name: 'all-min', pose: Object.fromEntries(BODY_POSE_KEYS.map((key) => [key, BODY_POSE_BOUNDS[key].min])) },
  { name: 'all-max', pose: Object.fromEntries(BODY_POSE_KEYS.map((key) => [key, BODY_POSE_BOUNDS[key].max])) },
  { name: 'heavy-arm-showcase', preset: 'arm_showcase', shape: { build: 0.7, arms: 0.4, belly: 0.8, waist: 0.6, hips: 0.4 } },
  { name: 'slim-flex', preset: 'flex', shape: { build: -0.7, arms: -1, legs: -1, waist: -0.6, height: -0.4 } },
  { name: 'tall-step', preset: 'step', shape: { height: 1, legLength: 1 } },
  { name: 'explicit-empty-overrides-preset', preset: 'arm_showcase', pose: {} },
  { name: 'malformed-values-clamped', pose: { leftElbow: 999, rightKnee: -90, headTurn: '30', headTilt: true, leftArmForward: 40 } },
  { name: 'lowered-shoulder-combined-cap', pose: { leftArmLift: -10, leftArmForward: 35, leftElbow: 85, rightArmLift: -8, rightArmForward: 34, rightElbow: 75 } },
];
const nativeArg = process.argv.indexOf('--blender-report');
const nativeDir = nativeArg >= 0 ? path.resolve(process.argv[nativeArg + 1]) : null;
for (const sex of ['male', 'female']) {
  const geometry = await loadBody(path.join(root, 'public/models', `body_${sex}_realistic.glb`), false);
  const d = prepareDeformable(geometry), bounds = shapeBounds([d]);
  const python = spawnSync(process.env.PYTHON ?? 'python3', [path.join(root, 'tools/body-pose-parity.py')], {
    input: JSON.stringify({ positions: Array.from(d.base), cases }), encoding: 'utf8', maxBuffer: 192 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.equal(python.status, 0, python.stderr || python.error?.message);
  const expected = JSON.parse(python.stdout);
  const boundsAsArrays = Object.fromEntries(Object.entries(BODY_POSE_BOUNDS).map(([key, value]) => [key, [value.min, value.max]]));
  assert.deepEqual(expected.bounds, boundsAsArrays, 'Blender angle bounds match the browser');
  assert.deepEqual(expected.backendBounds, boundsAsArrays, 'Server rejects the same out-of-range angles');
  assert.deepEqual(expected.presets, Object.fromEntries(BODY_POSE_PRESETS.map((preset) => [preset.id, preset.values])), 'Presets match Blender');
  const height = bounds.maxY - bounds.minY, cx = (bounds.minX + bounds.maxX) / 2, halfW = (bounds.maxX - bounds.minX) / 2;
  for (let vertex = 0; vertex < d.base.length / 3; vertex++) {
    const region = classifyRegion((d.base[vertex * 3 + 1] - bounds.minY) / height, (d.base[vertex * 3] - cx) / halfW);
    assert.equal(expected.regions[vertex], region, `${sex}: original region ${vertex}`);
  }
  let maximum = 0;
  for (let i = 0; i < cases.length; i++) {
    const test = cases[i];
    applyBodyShape([d], bounds, normalizeShape(test.shape));
    applyBodyPose([d], bounds, test.pose === undefined ? poseFromPreset(test.preset) : normalizePose(test.pose));
    const actual = geometry.getAttribute('position').array, reference = expected.cases[i].position;
    let delta = 0;
    for (let k = 0; k < actual.length; k++) {
      assert.ok(Number.isFinite(actual[k]) && Number.isFinite(reference[k]), `${sex} ${test.name}: finite vertex`);
      delta = Math.max(delta, Math.abs(actual[k] - Math.fround(reference[k])));
    }
    assert.ok(delta < 0.000001, `${sex} ${test.name}: browser/Blender pose delta ${delta}`);
    maximum = Math.max(maximum, delta);
  }
  console.log(`${sex}: ${cases.length} pose/shape cases × ${d.base.length / 3} vertices, maximum Python delta ${maximum}; original region tags match.`);
  if (nativeDir) {
    const native = JSON.parse(await fs.readFile(path.join(nativeDir, `${sex}-poses.json`), 'utf8'));
    const cage = new THREE.BufferGeometry();
    cage.setAttribute('position', new THREE.Float32BufferAttribute(native.position, 3));
    cage.setIndex(native.indices);
    const deformed = prepareDeformable(cage), cageBounds = shapeBounds([deformed]);
    let maxNative = 0;
    for (const test of native.cases) {
      applyBodyShape([deformed], cageBounds, normalizeShape(test.shape));
      applyBodyPose([deformed], cageBounds, test.pose === undefined ? poseFromPreset(test.preset) : normalizePose(test.pose));
      const positions = cage.getAttribute('position').array;
      for (let i = 0; i < positions.length; i++) maxNative = Math.max(maxNative, Math.abs(positions[i] - test.position[i]));
    }
    assert.ok(maxNative < 0.000001, `${sex}: actual native Blender wrapper delta ${maxNative}`);
    console.log(`${sex}: native Blender ${native.cases.length} poses, max delta ${maxNative}.`);
    cage.dispose();
  }
  geometry.dispose();
}
console.log('Pose contract, shape/pose math, presets and original region parity passed.');
