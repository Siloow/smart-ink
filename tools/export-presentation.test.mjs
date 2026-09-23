import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { build, transform } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const { outputFiles } = await build({
  stdin: { contents: "export * from './src/render/snapshot.ts'; export * from './src/render/exportPresentation.ts'; export * from './src/render/buildContract.ts'; export * from './src/render/studioSettings.ts'; export * as THREE from 'three';", resolveDir: root },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const helpers = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const { THREE, EXPORT_PRESETS, exportDimensions, paintExportBackground, withoutEditorHelpers, frameRegionCamera } = helpers;

for (const [id, preset] of Object.entries(EXPORT_PRESETS)) {
  assert.deepEqual(exportDimensions(id), { width: preset.width, height: preset.height });
  assert.deepEqual(exportDimensions(id, 'final'), exportDimensions(id));
  const preview = exportDimensions(id, 'preview');
  assert.equal(Math.max(preview.width, preview.height), 512);
  assert.ok(Math.abs(preview.width / preview.height - preset.width / preset.height) < 0.006);
}
for (const [name, expected] of Object.entries({ bluepurple: ['#3a1c71', '#d76d77', '#ffaf7b'], peach: ['#ffecd2', '#fcb69f'] })) {
  const colors = [], fills = [];
  paintExportBackground({ createLinearGradient: () => ({ addColorStop: (_, color) => colors.push(color) }), fillRect: (...args) => fills.push(args) }, 1080, 1920, name);
  assert.deepEqual(colors, expected, `${name} exports its real colors`);
  assert.deepEqual(fills, [[0, 0, 1080, 1920]]);
}

const scene = new THREE.Scene(), helper = new THREE.Object3D(), alreadyHidden = new THREE.Object3D();
helper.userData.editorHelper = alreadyHidden.userData.editorHelper = true;
alreadyHidden.visible = false;
const material = new THREE.ShaderMaterial({ uniforms: { uHighlightRegion: { value: 3 }, uHighlightRegion2: { value: 4 } } });
const body = new THREE.Mesh(new THREE.BoxGeometry(), material);
scene.add(helper, alreadyHidden, body, new THREE.Mesh(new THREE.BoxGeometry(), material));
assert.throws(() => withoutEditorHelpers(scene, () => {
  assert.equal(helper.visible, false);
  assert.equal(body.visible, true);
  assert.equal(material.uniforms.uHighlightRegion.value, -1);
  throw new Error('render failed');
}), /render failed/);
assert.equal(helper.visible, true);
assert.equal(alreadyHidden.visible, false);
assert.equal(material.uniforms.uHighlightRegion.value, 3, 'shared material restored once');
assert.equal(material.uniforms.uHighlightRegion2.value, 4);

for (const aspect of [0.25, 0.5625, 1, 2]) for (const direction of [[0, 0, 8], [8, 0, 0], [0, 8, 0], [0, 0, 0]]) {
  const focus = { center: [0.6, -0.2, 0.3], radius: 0.8 };
  const camera = frameRegionCamera(focus, direction, 45, aspect);
  assert.deepEqual(camera.target, focus.center);
  const distance = new THREE.Vector3(...camera.position).distanceTo(new THREE.Vector3(...camera.target));
  const halfFov = Math.min(Math.PI / 8, Math.atan(Math.tan(Math.PI / 8) * aspect));
  assert.ok(distance * Math.sin(halfFov) >= focus.radius, 'focus fits both fields of view');
}

// Exercise the real Workspace shot builder without React/WebGL plumbing.
const source = await fs.readFile(new URL('../src/Workspace.tsx', import.meta.url), 'utf8');
const snippet = source.slice(source.indexOf('  const buildShot ='), source.indexOf('  const handleLookChange'));
assert.ok(snippet.includes('const buildShot ='));
const names = ['resolveTattooSource', 'modelLoading', 'canvasHostRef', 'snapshotOutput', 'useCallback', 'uvPlacementRef', 'uploadedImage', 'decalVisible', 'orbitControlsRef', 'cameraState', 'bakeInkLayer', 'blankInkLayer', 'exportDimensions', 'buildRenderContract', 'exportPreset', 'bodyMeshId', 'skinToneId', 'poseId', 'lookId', 'qualityTier', 'finalSamples', 'bodyShape', 'bodyPose', 'bodyAppearance', 'studio', 'studioForExport', 'background', 'BACKGROUNDS', 'isolateRegion', 'lightingPreset', 'lights', 'LIGHTING_PRESETS'];
const compiled = await transform(`(function(${names.join(',')}) { ${snippet}; return buildShot; })`, { loader: 'ts' });
const createShot = (0, eval)(compiled.code);
for (const visible of [false, true]) {
  let baked = 0, blank = 0;
  const environment = {
    modelLoading: false, canvasHostRef: { current: { clientWidth: 1600, clientHeight: 900 } }, snapshotOutput: helpers.snapshotOutput,
    useCallback: (fn) => fn, resolveTattooSource: (source) => source || '/logo.png',
    uvPlacementRef: { current: { getPlacement: () => ({ hasPlaced: true, visible, center: [0, 0], scaleUV: 0, rotationRad: 0, surface: {} }) } },
    uploadedImage: 'test.png', decalVisible: visible, orbitControlsRef: { current: null },
    cameraState: { position: [0, 0, 8], target: [0, 0, 0], fov: 45 },
    bakeInkLayer: async () => { baked++; return new Blob(['ink']); },
    blankInkLayer: async () => { blank++; return new Blob(['transparent']); },
    exportDimensions, buildRenderContract: helpers.buildRenderContract,
    exportPreset: 'instagramStory', bodyMeshId: 'body_full', skinToneId: 'tone_03', poseId: 'neutral', lookId: 'studio_softbox', qualityTier: 'final', finalSamples: 64,
    studio: { mode: 'sweep', color: '#b99093', shadow: .6, showGuides: true }, studioForExport: helpers.studioForExport, background: 'white', BACKGROUNDS: helpers.BACKGROUNDS,
    bodyShape: undefined, bodyPose: { leftElbow: 35 }, bodyAppearance: { top: 'tshirt', bottom: 'trousers', hairStyle: 'short', hairTone: 'blond' }, isolateRegion: 'armRight', lightingPreset: 'studio', lights: [], LIGHTING_PRESETS: { studio: { threeIntensityScale: 1.1 } },
  };
  const shot = await createShot(...names.map((name) => environment[name]))();
  assert.equal(baked, visible ? 1 : 0);
  assert.equal(blank, visible ? 0 : 1, 'Show before never bakes hidden ink');
  assert.deepEqual(shot.contract.output, { qualityTier: 'final', width: 1080, height: 1920, samples: 64 });
  assert.equal(shot.contract.camera.aspect, 1080 / 1920);
  assert.equal(shot.contract.bodyRegion, 'armRight');
  assert.equal(shot.contract.bodyPose.leftElbow, 35, 'the actual shot builder exports edited joints');
  assert.deepEqual(shot.contract.studio, { mode: 'sweep', color: '#b99093', shadow: .6, showGuides: true });
  assert.equal(shot.contract.bodyAppearance.top, 'tshirt');
  assert.equal(shot.contract.bodyAppearance.bottom, 'trousers');
  assert.equal(shot.contract.bodyAppearance.hairStyle, 'short');
  assert.equal(shot.contract.bodyAppearance.hairTone, 'blond');
}
// A history outage must not turn a completed render into an error or block retry.
const renderSnippet = source.slice(source.indexOf('  const handleCloudRender ='), source.indexOf('  const openSnapshot ='));
const renderNames = ['renderController', 'setCloudRenderStatus', 'setCloudRenderMessage', 'setHistoryWarning', 'setRenderElapsed', 'setCloudRenderImage', 'buildShot', 'renderContract', 'addRenderHistory', 'fetch', 'currentScene', 'renderServer'];
const renderCode = await transform(`(function(${renderNames.join(',')}) { ${renderSnippet}; return handleCloudRender; })`, { loader: 'ts' });
const createRender = (0, eval)(renderCode.code);
let status, image, warning, releaseHistory;
const controller = { current: null };
const handler = createRender(controller, (s) => { status = s; }, () => {}, (s) => { warning = s; }, () => {}, (s) => { image = s; },
  async () => ({ contract: { output: { width: 512, height: 512, qualityTier: 'preview' }, lookId: 'studio_softbox' }, inkBlob: new Blob() }),
  async () => 'blob:completed-image',
  () => new Promise((_, reject) => { releaseHistory = () => reject(new Error('history unavailable')); }),
  async () => ({ blob: async () => new Blob(['render']) }), { name: 'Test scene' }, { cancellationSupported: true });
const completion = handler();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(status, 'done');
assert.equal(image, 'blob:completed-image');
assert.equal(controller.current, null, 'history I/O does not block Render Again');
releaseHistory();
await completion;
assert.equal(status, 'done', 'history failure cannot erase render success');
assert.match(warning, /ready to download/);
console.log('Export presentation passed: formats, gradients, helper cleanup, focused cameras, actual before/after builder, and history failures preserving completed renders.');
