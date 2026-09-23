/**
 * Run: node tools/placement-face-mask.test.mjs
 * Decodes the shipped male/female GLBs directly; no browser or network.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import draco3d from 'draco3d';
import * as THREE from 'three';

const root = fileURLToPath(new URL('../', import.meta.url));
const modelSource = await fs.readFile(path.join(root, 'src/ModelWithUVTattoo.tsx'), 'utf8');
const start = modelSource.indexOf("      mesh.geometry.setAttribute('aTattooUv', new THREE.BufferAttribute(chart.uv, 2));");
const end = modelSource.indexOf('      chartRef.current = chart;', start);
assert.ok(start >= 0 && end > start, 'production chart-to-render adapter must be present');
const { code } = await transform(`(function(mesh, chart, THREE) {
  ${modelSource.slice(start, end)}
})`, { loader: 'ts' });
const applyChart = (0, eval)(code);
// Check the current snapshot path passes the same live render geometry to bake.
assert.match(modelSource, /surface:\s*bodyMeshRef\.current\s*&&\s*chartRef\.current\s*\?\s*\{\s*geometry:\s*bodyMeshRef\.current\.geometry,\s*size,\s*aspect:\s*imageAspect/);

const { outputFiles } = await build({
  stdin: { contents: "export * from './src/render/bodyShape.ts'; export * from './src/render/surfacePlacement.ts';", resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { prepareDeformable, shapeBounds, applyBodyShape, BODY_SHAPE_KEYS, DEFAULT_BODY_SHAPE, createSurfaceTopology, buildSurfaceChart } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
);
const component = (attribute, vertex, axis) => attribute.array[vertex * attribute.itemSize + axis];
const weights = [[1 / 3, 1 / 3, 1 / 3], [0.12, 0.23, 0.65], [1, 0, 0]];

// Same largest-body-primitive selection and transforms as the existing
// surface-placement regression decoder, kept local to this bounded test.
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
  geometry.translate(-center.x, -center.y, -center.z);
  geometry.scale(4.2 / size.y, 4.2 / size.y, 4.2 / size.y);
  return geometry;
}

for (const sex of ['male', 'female']) {
  const original = await loadBody(path.join(root, 'public/models', `body_${sex}_realistic.glb`));
  const expanded = original.toNonIndexed();
  const corners = original.index.count;
  const triangles = corners / 3;
  assert.equal(expanded.index, null);
  assert.equal(expanded.getAttribute('position').count, corners, `${sex}: body triangle count retained`);

  for (const name of Object.keys(original.attributes)) {
    const indexed = original.getAttribute(name), flat = expanded.getAttribute(name);
    for (let corner = 0; corner < corners; corner++) {
      for (let axis = 0; axis < indexed.itemSize; axis++) {
        assert.equal(component(flat, corner, axis), component(indexed, original.index.getX(corner), axis), `${sex}: ${name} corner order`);
      }
    }
  }
  for (let face = 0; face < triangles; face++) {
    for (const barycentric of weights) {
      for (const name of ['position', 'uv']) {
        const indexed = original.getAttribute(name), flat = expanded.getAttribute(name);
        for (let axis = 0; axis < indexed.itemSize; axis++) {
          let oldValue = 0, newValue = 0;
          for (let corner = 0; corner < 3; corner++) {
            oldValue += barycentric[corner] * component(indexed, original.index.getX(face * 3 + corner), axis);
            newValue += barycentric[corner] * component(flat, face * 3 + corner, axis);
          }
          assert.equal(newValue, oldValue, `${sex}: saved face ${face} reconstructs the same ${name}`);
        }
      }
    }
  }

  const positionsBeforeMask = expanded.getAttribute('position').array.slice();
  const atlasBeforeMask = expanded.getAttribute('uv').array.slice();
  // Alternate adjacent accepted/rejected faces to expose shared-corner mistakes.
  const chart = {
    uv: new Float32Array(corners * 2),
    mask: new Float32Array(corners).fill(1),
    faceMask: Float32Array.from({ length: triangles }, (_, face) => face % 2),
  };
  chart.uv.set(expanded.getAttribute('uv').array);
  applyChart({ geometry: expanded }, chart, THREE);
  const renderMask = expanded.getAttribute('aTattooMask');
  for (let face = 0; face < triangles; face++) {
    for (let corner = 0; corner < 3; corner++) assert.equal(renderMask.getX(face * 3 + corner), face % 2, `${sex}: independent face mask`);
  }
  assert.ok(chart.mask.every((value) => value === 1), `${sex}: adapter preserves the solver mask`);
  assert.deepEqual(expanded.getAttribute('position').array, positionsBeforeMask, `${sex}: rejection preserves every body triangle`);
  assert.deepEqual(expanded.getAttribute('uv').array, atlasBeforeMask, `${sex}: rejection preserves original bake atlas`);
  for (const name of ['uv', 'aTattooUv', 'aTattooMask']) assert.equal(expanded.getAttribute(name).count, corners, `${sex}: export attribute count ${name}`);
  const exportSnapshot = expanded.clone();
  assert.deepEqual(exportSnapshot.getAttribute('aTattooMask').array, renderMask.array, `${sex}: bake clone matches preview face mask`);

  // The visual harness solves indexed references; the app now solves expanded
  // references. Compare both paths at the same real shoulder/armpit anchors.
  const indexedTopology = createSurfaceTopology(original), expandedTopology = createSurfaceTopology(expanded);
  const rayMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const rayMesh = new THREE.Mesh(original, rayMaterial);
  const cases = [
    { name: 'outer shoulder beside armpit', origin: [5, 1.071, 0], direction: [-1, 0, 0] },
    { name: 'front shoulder', origin: [sex === 'male' ? 0.48 : 0.46, 1.2, 3], direction: [0, 0, -1] },
  ];
  for (const { name, origin, direction } of cases) {
    const hit = new THREE.Raycaster(new THREE.Vector3(...origin), new THREE.Vector3(...direction)).intersectObject(rayMesh)[0];
    assert.ok(hit, `${sex} ${name}: regression ray`);
    const triangle = new THREE.Triangle(...[hit.face.a, hit.face.b, hit.face.c].map((id) => new THREE.Vector3().fromBufferAttribute(original.getAttribute('position'), id)));
    const anchor = { bodyMeshId: `body_${sex}`, faceIndex: hit.faceIndex, barycentric: triangle.getBarycoord(hit.point, new THREE.Vector3()).toArray() };
    const indexedChart = buildSurfaceChart(indexedTopology, original, new THREE.Matrix4(), anchor);
    const expandedChart = buildSurfaceChart(expandedTopology, expanded, new THREE.Matrix4(), anchor);
    assert.ok(indexedChart && expandedChart, `${sex} ${name}: both topology paths produce charts`);
    assert.deepEqual(expandedChart.faceMask, indexedChart.faceMask, `${sex} ${name}: accepted faces match the visual harness`);
    let maxUvDifference = 0;
    for (let corner = 0; corner < corners; corner++) {
      const id = original.index.getX(corner);
      assert.equal(expandedChart.mask[corner], indexedChart.mask[id], `${sex} ${name}: vertex chart membership`);
      for (let axis = 0; axis < 2; axis++) maxUvDifference = Math.max(maxUvDifference, Math.abs(expandedChart.uv[corner * 2 + axis] - indexedChart.uv[id * 2 + axis]));
    }
    assert.ok(maxUvDifference <= 0.00001, `${sex} ${name}: expanded chart UV difference ${maxUvDifference}`);
    assert.ok(Math.abs(indexedChart.maxSize - expandedChart.maxSize) <= 0.00001, `${sex} ${name}: safe-fit bound unchanged`);
    console.log(`${sex} ${name}: face ${anchor.faceIndex}, identical face mask, chart UV delta ${maxUvDifference}.`);
  }
  rayMaterial.dispose();

  const originalShape = prepareDeformable(original), expandedShape = prepareDeformable(expanded);
  const originalBounds = shapeBounds([originalShape]), expandedBounds = shapeBounds([expandedShape]);
  assert.deepEqual(expandedBounds, originalBounds, `${sex}: expansion preserves shaping bounds`);
  assert.equal(expandedShape.weldCount, originalShape.weldCount, `${sex}: seam weld count unchanged`);
  const shapes = [
    DEFAULT_BODY_SHAPE,
    Object.fromEntries(BODY_SHAPE_KEYS.map((key) => [key, -1])),
    Object.fromEntries(BODY_SHAPE_KEYS.map((key) => [key, 1])),
    { ...DEFAULT_BODY_SHAPE, shoulders: 0.5, chest: 0.4, waist: -0.3, arms: 0.4, legs: 0.3 },
  ];
  let maxShapeDifference = 0;
  for (const shape of shapes) {
    applyBodyShape([originalShape], originalBounds, shape);
    applyBodyShape([expandedShape], expandedBounds, shape);
    for (const name of ['position', 'normal']) {
      const indexed = original.getAttribute(name), flat = expanded.getAttribute(name);
      for (let corner = 0; corner < corners; corner++) {
        for (let axis = 0; axis < indexed.itemSize; axis++) {
          maxShapeDifference = Math.max(maxShapeDifference, Math.abs(component(flat, corner, axis) - component(indexed, original.index.getX(corner), axis)));
        }
      }
    }
    assert.ok(maxShapeDifference <= 0.000002, `${sex}: expanded shaping and welded normals match original (${maxShapeDifference})`);
    assert.equal(expanded.getAttribute('aTattooMask'), renderMask, `${sex}: shape changes preserve the per-face ink mask`);
  }
  console.log(`${sex}: ${triangles} faces; every anchor/UV preserved, adjacent face masks independent, four body shapes match (max delta ${maxShapeDifference}).`);
  original.dispose();
  expanded.dispose();
  exportSnapshot.dispose();
}
