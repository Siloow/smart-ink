/** Actual preview/Blender appearance math on both Draco model fixtures. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { loadBodyPreview } from './body-shape-visual-loader.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({ stdin: { contents: "export * from './src/render/bodyShape.ts';export * from './src/render/bodyPose.ts';export * from './src/render/bodyAppearance.ts';export * from './src/render/previewHair.ts';export * from './src/render/previewClothing.ts';", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const mod = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const triplets = data => Array.from({ length: data.length / 3 }, (_, i) => Array.from(data.subarray(i * 3, i * 3 + 3)));
function backend(request) {
  const run = spawnSync(process.env.PYTHON ?? 'python3', [`${root}/tools/appearance-parity.py`], { input: JSON.stringify(request), encoding: 'utf8', maxBuffer: 48 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr);return JSON.parse(run.stdout);
}
function compare(actual, expected, label, tolerance = 3e-6) {
  assert.equal(actual.length, expected.length, `${label} array length`);
  let maximum = 0;
  for (let i = 0; i < actual.length; i++) maximum = Math.max(maximum, Math.abs(actual[i] - expected[i]));
  assert.ok(maximum < tolerance, `${label}: error ${maximum}`);return maximum;
}
const hairCases = [
  { name: 'none', appearance: { hairStyle: 'none' } },
  { name: 'buzz-black', appearance: { hairStyle: 'buzz', hairTone: 'black' } },
  { name: 'short-brown', appearance: { hairStyle: 'short', hairTone: 'brown' } },
  { name: 'short-posed-blond', appearance: { hairStyle: 'short', hairTone: 'blond' }, shape: { head: .8, height: -.5 }, pose: { headTurn: 35, headTilt: -15 } },
];
const clothingCases = [
  { name: 'bare', appearance: {} },
  { name: 'casual-trousers', appearance: { top: 'tshirt', bottom: 'trousers' } },
  { name: 'casual-shorts-flex', appearance: { top: 'tshirt', bottom: 'shorts', topColor: '#6c7764' }, shape: { build: .7, arms: .8, legs: -.5 }, preset: 'flex' },
  { name: 'trousers-step', appearance: { bottom: 'trousers' }, shape: { height: -.6, legLength: 1 }, preset: 'step' },
];
for (const sex of ['male', 'female']) {
  const { geometry } = await loadBodyPreview(root, sex), deformable = mod.prepareDeformable(geometry), bounds = mod.shapeBounds([deformable]);
  const indices = Array.from(geometry.index.array), original = triplets(deformable.base);
  for (const c of hairCases) {
    const appearance = mod.normalizeAppearance(c.appearance);
    mod.applyBodyShape([deformable], bounds, mod.normalizeShape(c.shape));
    mod.applyBodyPose([deformable], bounds, mod.normalizePose(c.pose));
    const group = mod.createPreviewHair(geometry, deformable.base, bounds, appearance);
    const expected = backend({ kind: 'hair', original, posed: triplets(geometry.attributes.position.array), normals: triplets(geometry.attributes.normal.array), indices, appearance });
    const mesh = group.children[0];
    for (const [key, attr] of [['positions', 'position'], ['normals', 'normal'], ['colors', 'color']]) compare(mesh?.geometry.attributes[attr].array ?? [], expected[key], `${sex} ${c.name} ${key}`);
    assert.equal(group.userData.lockCount ?? 0, expected.lockCount);
    mod.disposePreviewHair(group);
    console.log(`${sex} ${c.name}: geometry, normals, color, and lock count match Blender`);
  }
  for (const c of clothingCases) {
    const appearance = mod.normalizeAppearance(c.appearance);
    mod.applyBodyShape([deformable], bounds, mod.normalizeShape(c.shape));
    const shaped = geometry.attributes.position.array.slice();
    mod.applyBodyPose([deformable], bounds, mod.poseFromPreset(c.preset ?? 'neutral'));
    const group = mod.createClothing(geometry, deformable.base, bounds, appearance, shaped);
    const expected = backend({ kind: 'clothing', original, shaped: triplets(shaped), posed: triplets(geometry.attributes.position.array), indices, appearance });
    const meshes = [];
    group.traverse(child => { if (child.isMesh) meshes.push(child); });
    assert.equal(meshes.length, expected.meshes.length);
    compare(mod.createClothingCoverage(deformable.base, bounds, appearance), expected.coverage, `${sex} ${c.name} clothing coverage`, 1e-8);
    for (let i = 0; i < meshes.length; i++) {
      const mesh = meshes[i], expanded = mesh.geometry.toNonIndexed();
      assert.equal(mesh.name, expected.meshes[i].name);
      compare(expanded.attributes.position.array, expected.meshes[i].positions, `${sex} ${c.name} ${mesh.name} positions`);
      compare(expanded.attributes.normal.array, expected.meshes[i].normals, `${sex} ${c.name} ${mesh.name} normals`, 8e-5);
      expanded.dispose();mesh.geometry.dispose();mesh.material.dispose();
    }
    console.log(`${sex} ${c.name}: garment/hem geometry and skin coverage match Blender`);
  }
  geometry.dispose();
}
