/** Execute Workspace's real shot/open callbacks with production contract/session code.
 * Only browser/GPU I/O is substituted; no second implementation of the workflow. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = await fs.readFile(new URL('../src/Workspace.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Workspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declarations = new Map();
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) declarations.set(node.name.text, node);
  ts.forEachChild(node, visit);
};
visit(ast);
async function callback(name, names) {
  const declaration = declarations.get(name);
  assert.ok(declaration?.initializer, `Workspace still declares ${name}`);
  const { code } = await transform(`(function(${names.join(',')}) { const ${name} = ${declaration.initializer.getText(ast)}; return ${name}; })`, { loader: 'tsx' });
  const create = (0, eval)(code);
  return (scope) => create(...names.map((key) => {
    assert.ok(Object.hasOwn(scope, key), `test supplies the real callback's ${key} dependency`);
    return scope[key];
  }));
}
const { outputFiles } = await build({
  stdin: { contents: `export * from './src/render/buildContract'; export * from './src/render/snapshot'; export * from './src/render/tattooSource'; export * from './src/render/tattooCamera'; export * from './src/render/studioSettings'; export * from './src/render/exportPresentation'; export * from './src/services/snapshotSession'; export * as THREE from 'three';`, resolveDir: root },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const dependencies = ['bodyFit', 'useCallback', 'uvPlacementRef', 'uploadedImage', 'decalVisible', 'orbitControlsRef', 'cameraState', 'canvasHostRef', 'modelLoading', 'bakeInkLayer', 'blankInkLayer', 'snapshotOutput', 'exportDimensions', 'buildRenderContract', 'exportPreset', 'bodyMeshId', 'skinToneId', 'poseId', 'lookId', 'qualityTier', 'finalSamples', 'bodyShape', 'bodyPose', 'bodyAppearance', 'studio', 'studioForExport', 'background', 'BACKGROUNDS', 'isolateRegion', 'lightingPreset', 'lights', 'LIGHTING_PRESETS', 'resolveTattooSource'];
const makeShot = await callback('buildShot', dependencies);
const makeOpen = await callback('openSnapshot', ['renderBusy', 'modelLoading', 'canvasHostSized', 'setShapeMenu', 'setHoverRegion', 'setPanelRegions', 'setAccountMenuOpen', 'snapshotSession', 'currentShotBuilder', 'snapshotReturnCamera', 'orbitControlsRef', 'cameraState', 'setTattooFraming', 'setSnapshotHasTattoo', 'setSnapshotFramingHint', 'regionSnapshotFraming', 'setSnapshotCamera', 'uvPlacementRef', 'DEFAULT_TATTOO_CAMERA_ADJUSTMENT', 'currentScene']);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
function fixture(overrides = {}) {
  const geometry = new api.THREE.BufferGeometry();
  const placement = { hasPlaced: true, imageReady: true, visible: true, center: [.2, .3], scaleUV: .42, rotationRad: Math.PI / 3,
    surface: { geometry, size: .58, aspect: 1 / 3, color: '#992344', opacity: .37 } };
  const live = { position: [3, .5, 6], target: [.2, -.3, .1], fov: 38, aspect: 16 / 9 };
  const stateCamera = { position: [0, 0, -8], target: [0, 0, 0], fov: 55 };
  const calls = { freeze: 0, freezeFlags: [], snapshot: 0, baked: [], blank: 0 };
  const ink = new Blob(['snapshot ink'], { type: 'image/png' });
  const scope = {
    useCallback: (fn) => fn, modelLoading: false, bodyFit: null,
    uvPlacementRef: { current: { getPlacement: () => placement, getTattooFraming: () => ({ center: [.2, .8, .1], radius: .4 }), getRegionFraming: () => ({ center: [0, 0, 0], radius: 1 }) } },
    uploadedImage: 'data:image/png;base64,dGVzdA==', decalVisible: true,
    orbitControlsRef: { current: {
      freezeSnapshot: (finish) => { calls.freeze++; calls.freezeFlags.push(finish); return structuredClone(live); },
      getSnapshot: () => { calls.snapshot++; return live; },
    } }, cameraState: stateCamera,
    canvasHostRef: { current: { clientWidth: 1600, clientHeight: 900 } },
    bakeInkLayer: async (params) => { calls.baked.push(params); return ink; },
    blankInkLayer: async () => { calls.blank++; return new Blob(['transparent']); },
    resolveTattooSource: api.resolveTattooSource, snapshotOutput: api.snapshotOutput, exportDimensions: api.exportDimensions, buildRenderContract: api.buildRenderContract,
    exportPreset: 'instagramStory', bodyMeshId: 'body_full', skinToneId: 'tone_03', poseId: 'custom', lookId: 'studio_softbox', qualityTier: 'preview', finalSamples: 128,
    bodyShape: { build: .25, height: -.1 }, bodyPose: { leftElbow: 35, headTurn: 12 },
    bodyAppearance: { top: 'tshirt', bottom: 'shorts', topColor: '#256345', bottomColor: '#555577', hairStyle: 'short', hairTone: 'blond' },
    studio: { mode: 'sweep', color: '#b99093', shadow: .6, showGuides: true },
    studioForExport: api.studioForExport, background: 'white', BACKGROUNDS: api.BACKGROUNDS,
    isolateRegion: 'armRight', lightingPreset: 'studio',
    lights: [{ type: 'spot', position: [1, 3, 4], target: [0, .5, 0], color: '#ffaa77', intensity: 1.2, angle: .5, enabled: true, softness: .6 }, { type: 'ambient', color: '#ffffff', intensity: .2, enabled: false }],
    LIGHTING_PRESETS: { studio: { threeIntensityScale: 1.1 } }, ...overrides,
  };
  return { scope, calls, placement, live, ink, build: () => makeShot(scope), dispose: () => geometry.dispose() };
}

// Snapshot finishes its requested composition transition before capturing,
// independent of the saved destination and the separately selected export format.
for (const aspect of [.4, 1, 16 / 9, 2.5]) for (const quality of ['quick', 'detailed']) {
  const f = fixture(); f.live.aspect = aspect;
  const signal = new AbortController().signal;
  const shot = await f.build()({ snapshot: quality, signal });
  assert.equal(f.calls.freeze, 1); assert.deepEqual(f.calls.freezeFlags, [true]); assert.equal(f.calls.snapshot, 0);
  assert.deepEqual(shot.contract.camera, { position: f.live.position, target: f.live.target, fov: f.live.fov, aspect });
  assert.deepEqual(shot.contract.output, api.snapshotOutput(aspect, quality));
  assert.equal(shot.contract.bodyRegion, 'armRight');
  assert.equal(shot.contract.bodyPose.leftElbow, 35); assert.equal(shot.contract.bodyShape.build, .25);
  assert.equal(shot.contract.bodyAppearance.top, 'tshirt'); assert.equal(shot.contract.bodyAppearance.bottom, 'shorts');
  assert.equal(shot.contract.studio.color, '#b99093'); assert.equal(shot.contract.studio.mode, 'sweep');
  assert.deepEqual(shot.contract.lighting.lights, f.scope.lights, 'edited and disabled lights are preserved');
  assert.equal(shot.inkBlob, f.ink);
  assert.equal(f.calls.baked[0].surface, f.placement.surface, 'actual surface geometry, tint and opacity reach the baker');
  assert.equal(f.calls.baked[0].rotationRad, f.placement.rotationRad);
  assert.equal(f.calls.baked[0].size, 4096, 'Both snapshot qualities retain full-resolution ink when rerendering');
  assert.equal(f.calls.baked[0].signal, signal); assert.equal(f.calls.baked[0].tattooImage, f.scope.uploadedImage);
  f.dispose();
}
{
  const f = fixture(); const shot = await f.build()();
  assert.equal(f.calls.freeze, 0); assert.equal(f.calls.snapshot, 1);
  assert.deepEqual(shot.contract.output, { qualityTier: 'preview', width: 288, height: 512 });
  assert.equal(shot.contract.camera.aspect, 288 / 512, 'legacy export still uses its chosen output format');
  f.scope.orbitControlsRef.current = null;
  const fallback = await f.build()({ snapshot: 'quick' });
  assert.equal(fallback.contract.camera.aspect, 1600 / 900, 'fallback reads current canvas dimensions');
  assert.deepEqual(fallback.contract.camera.position, f.scope.cameraState.position); f.dispose();
}

// Hidden ink remains hidden even without a loaded image or an existing anchor.
for (const hidden of ['show-before', 'placement-hidden']) {
  const f = fixture();
  if (hidden === 'show-before') { f.scope.decalVisible = false; f.scope.uploadedImage = null; f.placement.hasPlaced = false; }
  else f.placement.visible = false;
  const shot = await f.build()({ snapshot: 'quick' });
  assert.equal(f.calls.baked.length, 0); assert.equal(f.calls.blank, 1);
  assert.equal(await shot.inkBlob.text(), 'transparent'); f.dispose();
}
for (const reason of ['model-loading', 'body-unavailable', 'image-loading', 'pre-aborted']) {
  const f = fixture(), controller = new AbortController();
  if (reason === 'model-loading') f.scope.modelLoading = true;
  if (reason === 'body-unavailable') f.scope.uvPlacementRef.current.getRegionFraming = () => null;
  if (reason === 'image-loading') f.placement.imageReady = false;
  if (reason === 'pre-aborted') controller.abort();
  await assert.rejects(f.build()({ snapshot: 'quick', signal: controller.signal }), /loading|load|place|aborted/i, reason);
  assert.equal(f.calls.freeze, 0, `${reason} cannot freeze an unready shot`); assert.equal(f.calls.baked.length, 0); f.dispose();
}

// Edits while the image is being prepared must not change this shot's metadata.
{
  const f = fixture(), pending = deferred();
  f.scope.bakeInkLayer = (params) => { f.calls.baked.push(params); return pending.promise; };
  const shotPromise = f.build()({ snapshot: 'quick' });
  assert.equal(f.calls.baked.length, 1, 'capture begins synchronously');
  f.live.position[0] = 999; f.live.target[1] = 999;
  f.scope.lights[0].target[0] = 999; f.scope.lights[0].color = '#000000';
  f.scope.bodyPose.leftElbow = 0; f.scope.bodyShape.build = -.8;
  f.scope.bodyAppearance.topColor = '#000000'; f.scope.studio.color = '#000000';
  pending.resolve(f.ink); const shot = await shotPromise;
  assert.equal(shot.contract.camera.position[0], 3); assert.equal(shot.contract.camera.target[1], -.3);
  assert.equal(shot.contract.lighting.lights[0].target[0], 0); assert.equal(shot.contract.lighting.lights[0].color, '#ffaa77');
  assert.equal(shot.contract.bodyPose.leftElbow, 35); assert.equal(shot.contract.bodyShape.build, .25);
  assert.equal(shot.contract.bodyAppearance.topColor, '#256345'); assert.equal(shot.contract.studio.color, '#b99093'); f.dispose();
}
{
  const f = fixture(), pending = deferred(), controller = new AbortController();
  f.scope.blankInkLayer = () => pending.promise; f.scope.decalVisible = false;
  const promise = f.build()({ snapshot: 'quick', signal: controller.signal });
  controller.abort(); pending.resolve(new Blob());
  await assert.rejects(promise, { name: 'AbortError' }); f.dispose();
}

function openerScope(f, session, overrides = {}) {
  const menuChanges = [];
  return {
    renderBusy: false, modelLoading: false, canvasHostSized: true,
    setShapeMenu: (value) => menuChanges.push(['shape', value]), setHoverRegion: (value) => menuChanges.push(['hover', value]),
    setPanelRegions: (value) => menuChanges.push(['regions', value]), setAccountMenuOpen: (value) => menuChanges.push(['account', value]),
    snapshotSession: session, currentShotBuilder: { current: f.build() }, snapshotReturnCamera: { current: null }, orbitControlsRef: f.scope.orbitControlsRef, cameraState: f.scope.cameraState, uvPlacementRef: f.scope.uvPlacementRef, setTattooFraming: () => {}, setSnapshotHasTattoo: () => {}, setSnapshotFramingHint: () => {}, regionSnapshotFraming: api.regionSnapshotFraming, setSnapshotCamera: () => {}, DEFAULT_TATTOO_CAMERA_ADJUSTMENT: api.DEFAULT_TATTOO_CAMERA_ADJUSTMENT, currentScene: { name: 'My current figure' }, menuChanges, ...overrides,
  };
}
for (const guard of ['renderBusy', 'modelLoading', 'canvasHostSized']) {
  const f = fixture(), renders = [];
  const session = api.createSnapshotSession({ render: async (...args) => { renders.push(args); return 'blob:blocked'; }, revoke: () => {} });
  const scope = openerScope(f, session, { [guard]: guard !== 'canvasHostSized' });
  makeOpen(scope)(); await tick();
  assert.equal(session.getState().open, false, `${guard} prevents opening`); assert.equal(f.calls.freeze, 0); assert.equal(renders.length, 0);
  assert.deepEqual(scope.menuChanges, [], 'blocked opening has no UI side effects'); session.close(); f.dispose();
}
{
  const f = fixture(), requests = [], histories = [], revoked = [];
  const session = api.createSnapshotSession({
    render: async (contract, ink, options) => { requests.push({ contract, ink, options }); return `blob:shot-${requests.length}`; },
    retain: async (shot) => { histories.push(shot); }, revoke: (url) => revoked.push(url),
  });
  const scope = openerScope(f, session); const open = makeOpen(scope); open(); open(); await tick();
  assert.equal(session.getState().mode, 'compose'); assert.equal(requests.length, 0, 'opening does not submit to Blender');
  assert.equal(f.calls.baked.length, 0, 'opening does not bake ink');
  assert.deepEqual(scope.snapshotReturnCamera.current.position, [3,.5,6]);
  await session.render();
  assert.deepEqual(scope.menuChanges.slice(0, 4), [['shape', null], ['regions', []], ['account', false]]);
  assert.equal(session.getState().status, 'done'); assert.equal(requests.length, 1, 'double click cannot submit twice');
  assert.equal(f.calls.freeze, 2); assert.equal(f.calls.baked.length, 1);
  const request = requests[0];
  assert.equal(request.contract.renderStyle, 'cinematic'); assert.equal(request.contract.camera.preserveFraming, true); assert.equal(request.contract.camera.aperture, 8);
  assert.equal(request.contract.camera.aspect, 16 / 9); assert.deepEqual(request.contract.camera.position, [3, .5, 6]);
  assert.equal(request.ink, f.ink); assert.equal(request.options.signal, f.calls.baked[0].signal);
  assert.equal(histories[0].sceneName, 'My current figure');
  f.live.position[0] = 999; f.scope.lights[0].color = '#000000';
  session.setQuality('detailed'); await session.render();
  assert.equal(requests.length, 2); assert.equal(f.calls.freeze, 2); assert.equal(f.calls.baked.length, 1, 'quality rerender reuses the frozen ink');
  assert.equal(requests[1].contract.camera.position[0], 3); assert.equal(requests[1].contract.lighting.lights[0].color, '#ffaa77');
  assert.deepEqual(requests[1].contract.output, api.snapshotOutput(16 / 9, 'detailed'));
  assert.deepEqual(revoked, ['blob:shot-1']); session.close(); assert.deepEqual(revoked, ['blob:shot-1', 'blob:shot-2']); f.dispose();
}
for (const action of ['close', 'cancel']) {
  const f = fixture(), pending = deferred(), requests = [];
  f.scope.bakeInkLayer = (params) => { f.calls.baked.push(params); return pending.promise; };
  const session = api.createSnapshotSession({ render: async (...args) => { requests.push(args); return 'blob:late'; }, revoke: () => {} });
  makeOpen(openerScope(f, session))(); void session.render(); assert.equal(f.calls.baked.length, 1);
  session[action](); assert.equal(f.calls.baked[0].signal.aborted, true, 'close/cancel reaches the actual baker signal');
  pending.resolve(f.ink); await tick();
  assert.equal(requests.length, 0, 'a cancelled Workspace preparation never reaches Blender');
  assert.equal(session.getState().status, action === 'cancel' ? 'cancelled' : 'idle'); session.close(); f.dispose();
}

console.log('Snapshot Workspace passed: actual builder/open callbacks, live camera/aspect, hidden ink, tint/opacity/pose/clothes/lights, loading guards, frozen metadata, cancellation and quality rerenders.');

// The built-in example is a real image source for every export path.
for (const options of [undefined, {snapshot:'quick'}, {snapshot:'detailed'}]) {
 const f=fixture({uploadedImage:null});
 await f.build()(options);assert.equal(f.calls.baked[0].tattooImage,'/logo.png');
 f.placement.imageSource='data:image/png;base64,already-loaded';
 await f.build()(options);assert.equal(f.calls.baked[1].tattooImage,f.placement.imageSource,'the loaded texture is authoritative');f.dispose();
}
// Adjust uses the latest Workspace callback instead of stale opening lights.
{
 const f=fixture(),sent=[];const session=api.createSnapshotSession({render:async c=>{sent.push(c);return 'blob:latest';},revoke:()=>{}});
 const scope=openerScope(f,session);makeOpen(scope)();
 f.scope.lights=[{type:'ambient',position:[0,0,0],color:'#ccbbaa',intensity:.4}];scope.currentShotBuilder.current=f.build();
 await session.render();assert.equal(sent[0].lighting.lights[0].color,'#ccbbaa');session.adjust();
 f.live.target=[.5,.8,.2];f.scope.lights=[{type:'ambient',position:[0,0,0],color:'#abcdef',intensity:.2}];scope.currentShotBuilder.current=f.build();
 await session.render();assert.deepEqual(sent[1].camera.target,[.5,.8,.2]);assert.equal(sent[1].lighting.lights[0].color,'#abcdef');assert.equal(f.calls.baked.length,2);session.close();f.dispose();
}
console.log('Composition Workspace passed: setup-before-render, source fallback, latest camera/lights, finish transition and recapture after Adjust.');

// No placed tattoo still has a useful, anchored figure shot; covered ink keeps the body fallback.
for (const placed of [false,true]) {
 const f=fixture();f.placement.hasPlaced=placed;f.scope.uvPlacementRef.current.getTattooFraming=()=>null;
 const session=api.createSnapshotSession({render:async()=> 'blob:body',revoke:()=>{}});let frame,hasTattoo,hint;
 makeOpen(openerScope(f,session,{setTattooFraming:v=>frame=v,setSnapshotHasTattoo:v=>hasTattoo=v,setSnapshotFramingHint:v=>hint=v}))();
 assert.equal(hasTattoo,false);assert.deepEqual(frame.center,[0,0,0]);assert.ok(frame.points.length);
 const a=api.frameTattoo(frame,{azimuth:0},1),b=api.frameTattoo(frame,{azimuth:20},1);
 assert.notDeepEqual(a.position,b.position);assert.deepEqual(a.target,b.target);
 assert.match(hint,placed?/covered/:/without ink/);await session.render();assert.equal(session.getState().status,'done');
 assert.equal(f.calls.blank,placed?0:1);assert.equal(f.calls.baked.length,placed?1:0);session.close();f.dispose();
}
// Returning to editing restores the pre-Snapshot camera and consumes the saved view once.
{
 const makeClose=await callback('closeSnapshot',['useCallback','snapshotSession','snapshotReturnCamera','setCameraState','setCameraRequestId','setCameraPreset']);
 const restored=[];let closed=0,request=4;const saved={position:[4,2,6],target:[0,1,0],fov:48};const ref={current:saved};
 const close=makeClose({useCallback:f=>f,snapshotSession:{close:()=>closed++},snapshotReturnCamera:ref,setCameraState:v=>restored.push(v),setCameraRequestId:f=>request=f(request),setCameraPreset:v=>assert.equal(v,'custom')});
 close();close();assert.equal(closed,2);assert.deepEqual(restored,[saved]);assert.equal(request,5);assert.equal(ref.current,null);
}
console.log('Fallback/exit passed: no-tattoo controls move the camera, uncovered/covered hints, body-only render and original camera restoration.');

for (const background of ['gray', 'bluepurple', 'peach']) {
  const f = fixture({ background, studio: { mode: 'plain', color: '#ffffff', shadow: .4, showGuides: false } });
  const shot = await f.build()({ snapshot: 'detailed' });
  assert.ok(shot.contract.studio.gradient.length >= 2);
  assert.equal(shot.contract.studio.gradient[0], shot.contract.studio.color);
  assert.equal(shot.contract.output.samples, 512);
  assert.equal(shot.contract.showEyes, true);
  assert.equal(shot.contract.eyeColor, '#634530');
  f.dispose();
}
console.log('Viewport gradient choices survive the real snapshot builder.');

{ const f = fixture({ bodyFit: { version: 1 } }); await assert.rejects(f.build()({ snapshot: 'quick' }), /measurement fit is invalid/); assert.equal(f.calls.baked.length, 0); f.dispose(); }

// A measured snapshot replaces old sliders and freezes its recipe before async baking.
{
  const recipes = JSON.parse(await fs.readFile(new URL('./fixtures/body-fit-recipes.json', import.meta.url), 'utf8'));
  const bodyFit = structuredClone(recipes[1].fit);
  const expected = structuredClone(bodyFit);
  const baking = deferred();
  const f = fixture({ bodyFit, bakeInkLayer: () => baking.promise });
  const pending = f.build()({ snapshot: 'quick' });
  bodyFit.measurements.waist += 5; bodyFit.parameters[0] += .01;
  baking.resolve(f.ink);
  const shot = await pending;
  assert.deepEqual(shot.contract.bodyFit, expected);
  assert.equal(shot.contract.bodyShape, undefined);
  assert.equal(shot.contract.bodyPose.leftElbow, 35);
  assert.equal(shot.contract.bodyRegion, 'armRight');
  f.dispose();
}
