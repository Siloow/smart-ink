/** Production camera path and control lifecycle, with real THREE camera math. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import fs from 'node:fs/promises';
import ts from 'typescript';
import * as THREE from 'three';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = await build({
  stdin: { contents: `export * from './src/render/cameraTransition'; export {default as Controls} from './src/OrbitControlsWithCmdLock';`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'controlled-react-and-canvas', setup(builder) {
    builder.onResolve({ filter: /^(react(?:\/jsx-runtime)?|@react-three\/(fiber|drei))$/ }, (args) => ({ path: args.path, namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, ({ path }) => ({ contents: path === 'react'
      ? `export const forwardRef=fn=>fn; export const useRef=(...a)=>globalThis.__cameraHooks.useRef(...a); export const useCallback=(...a)=>globalThis.__cameraHooks.useCallback(...a); export const useEffect=(...a)=>globalThis.__cameraHooks.useEffect(...a); export const useImperativeHandle=(ref,fn)=>{ref.current=fn()};`
      : path === 'react/jsx-runtime'
        ? 'export const jsx=(type,props)=>({type,props}); export const jsxs=jsx;'
        : path === '@react-three/fiber'
          ? 'export const useThree=()=>globalThis.__cameraHooks.environment; export const useFrame=fn=>globalThis.__cameraHooks.frame=fn;'
          : 'export const OrbitControls="OrbitControls";' }));
  } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const { createCameraTransition: transition, sampleCameraTransition: sample, cameraViewsEqual: equal, CAMERA_TRANSITION_DURATION_MS: duration } = api;
const front = { position: [0, 0, 8], target: [0, 0, 0], fov: 45 };
const back = { position: [0, 0, -8], target: [0, 0, 0], fov: 55 };
const radius = (view) => new THREE.Vector3(...view.position).distanceTo(new THREE.Vector3(...view.target));
const assertView = (actual, expected, message) => assert.ok(equal(actual, expected, 1e-6), `${message}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);

// Front/back never cuts along a chord through the figure. Every intermediate
// radius remains bounded even while changing target, zoom and field of view.
{
  const path = transition(front, back);
  for (let i = 0; i <= 100; i++) assert.ok(Math.abs(radius(sample(path, i / 100)) - 8) < 1e-9);
  const middle = sample(path, .5);
  assert.ok(Math.abs(middle.position[0]) > 7.99); assert.equal(middle.fov, 50);
  assertView(sample(path, 0), front, 'exact initial endpoint'); assertView(sample(path, 1), back, 'exact final endpoint');
  const shifted = { position: [4, 5, 5], target: [4, 5, 1], fov: 30 };
  const change = transition(front, shifted);
  for (let i = 0; i <= 100; i++) {
    const view = sample(change, i / 100);
    assert.ok(radius(view) >= 4 - 1e-9 && radius(view) <= 8 + 1e-9);
    assert.ok(view.position.every(Number.isFinite)); assert.ok(view.fov >= 30 && view.fov <= 45);
  }
  const early = sample(change, .001), late = sample(change, .999);
  assert.ok(new THREE.Vector3(...early.target).length() < .0001, 'ease starts gently');
  assert.ok(new THREE.Vector3(...late.target).distanceTo(new THREE.Vector3(...shifted.target)) < .0001, 'ease ends gently');
}
{
  const view = (degrees) => ({ ...front, position: [Math.sin(degrees * Math.PI / 180) * 8, 0, Math.cos(degrees * Math.PI / 180) * 8] });
  const short = transition(view(179), view(-179));
  assert.ok(Math.abs(short.yawDelta) < .04, 'wraparound uses two degrees, not 358');
  assert.ok(sample(short, .5).position[2] < -7.99);
  for (const [a, b] of [[{ ...front, position: [0, 8, 0] }, back], [front, { ...front, position: [0, -8, 0] }]]) {
    const path = transition(a, b);
    for (let i = 0; i <= 100; i++) assert.ok(sample(path, i / 100).position.every(Number.isFinite), 'pole path stays finite');
  }
  const a = structuredClone(front), b = structuredClone(back), path = transition(a, b);
  a.position[0] = 999; b.target[0] = 999;
  assertView(sample(path, 0), front, 'transition snapshots source'); assertView(sample(path, 1), back, 'transition snapshots destination');
}

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(type, callback) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    emit(type, event = {}) { for (const callback of [...(listeners.get(type) ?? [])]) callback(event); },
    count() { return [...listeners.values()].reduce((total, set) => total + set.size, 0); },
  };
}
const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');

function harness(initial = front, { reduced = false, explicit = true, camera: existingCamera } = {}) {
  const camera = existingCamera ?? new THREE.PerspectiveCamera(45, 16 / 9, .1, 100);
  const canvas = Object.assign(eventTarget(), { clientWidth: 1600, clientHeight: 900 });
  const media = Object.assign(eventTarget(), { matches: reduced });
  const window = Object.assign(eventTarget(), { matchMedia: () => media });
  const controls = Object.assign(eventTarget(), {
    target: new THREE.Vector3(), enabled: true, enableDamping: true, inertia: 0,
    update() {
      if (this.inertia) { camera.position.x += this.inertia; this.inertia = this.enableDamping ? this.inertia * .8 : 0; }
      camera.lookAt(this.target); this.emit('change');
    },
  });
  let now = 0, cursor = 0, pending = true, unmounted = false, starts = 0, invalidations = 0;
  const hooks = [], effects = [], reports = [], ref = { current: null }, scene = new THREE.Scene();
  const props = {
    enabled: true, cameraState: structuredClone(initial), cameraRequestId: explicit ? 0 : undefined,
    setCameraState(view) { reports.push(view); props.cameraState = view; pending = true; },
    onOrbitStart() { starts++; },
  };
  const different = (a, b) => !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
  const runtime = {
    environment: { camera, gl: { domElement: canvas }, scene, invalidate: () => invalidations++ }, frame: null,
    useRef(value) { const index = cursor++; return hooks[index] ??= { current: value }; },
    useCallback(value, deps) { const index = cursor++; if (different(hooks[index]?.deps, deps)) hooks[index] = { value, deps }; return hooks[index].value; },
    useEffect(fn, deps) {
      const index = cursor++;
      if (different(hooks[index]?.deps, deps)) effects.push(() => { hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: fn() }; });
    },
  };
  globalThis.__cameraHooks = runtime; globalThis.window = window;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
  const settle = () => {
    let remaining = 30;
    while (pending && !unmounted) {
      assert.ok(remaining-- > 0, 'camera feedback must not create a render loop');
      pending = false; cursor = 0;
      const tree = api.Controls(props, ref); tree.props.ref.current = controls;
      // Drei applies changed props during commit, before component effects.
      if (controls.renderedEnabled !== tree.props.enabled) {
        controls.enabled = controls.renderedEnabled = tree.props.enabled;
      }
      effects.splice(0).forEach((effect) => effect());
    }
  };
  settle();
  return {
    camera, controls, canvas, window, media, reports, scene, ref,
    get starts() { return starts; }, get invalidations() { return invalidations; },
    snapshot: () => ref.current.getSnapshot(),
    freeze(finishTransition) { const view = ref.current.freezeSnapshot(finishTransition); settle(); return view; },
    enabled(value) { props.enabled = value; pending = true; settle(); },
    request(view) { props.cameraState = structuredClone(view); if (explicit) props.cameraRequestId++; pending = true; settle(); },
    echo(view) { props.cameraState = structuredClone(view); pending = true; settle(); },
    frame(ms) { now += ms; if (!unmounted) runtime.frame?.(); settle(); },
    emit(target, type, event) { target.emit(type, event); settle(); },
    move(view) { camera.position.set(...view.position); controls.target.set(...view.target); camera.fov = view.fov; controls.emit('change'); settle(); },
    unmount() { unmounted = true; hooks.forEach((hook) => hook?.cleanup?.()); runtime.frame = null; },
  };
}

// Execute the actual Model's pointer-release callback against the same shared
// controls. Window pointerup/blur still fires while Snapshot's overlay is open.
const modelSource = await fs.readFile(new URL('../src/ModelWithUVTattoo.tsx', import.meta.url), 'utf8');
const modelAst = ts.createSourceFile('Model.tsx', modelSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const modelCallbacks = new Map();
function visitModel(node) {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && ['setOrbitEnabled', 'finishPointer'].includes(node.name.text)) {
    modelCallbacks.set(node.name.text, node.initializer.getText(modelAst));
  }
  ts.forEachChild(node, visitModel);
}
visitModel(modelAst);
const modelCode = await transform(`(() => { const setOrbitEnabled = ${modelCallbacks.get('setOrbitEnabled')}; const finishPointer = ${modelCallbacks.get('finishPointer')}; return finishPointer; })()`, { loader: 'ts' });
function modelPointerRelease(app, editingEnabled) {
  const scope = {
    useCallback: fn => fn, scene: app.scene, editingEnabled,
    pick: () => { throw Error('Disabled editing must not pick'); },
    applyAnchor: () => { throw Error('Disabled editing must not place'); },
    gl: { domElement: { hasPointerCapture: () => false } }, onPlacementStatus: undefined,
    pointerStart: { current: null }, pendingMove: { current: null }, dragFrame: { current: null }, isDragging: { current: false },
  };
  return new Function('scope', `with (scope) { return ${modelCode.code} }`)(scope);
}

// Exact load, uninterrupted transition, final snapshot and unchanged-request
// feedback. Tween frames do not enqueue saves or restart themselves.
{
  const app = harness();
  assertView(app.snapshot(), front, 'initial saved camera snaps'); assert.equal(app.snapshot().aspect, 16 / 9);
  app.request(back); assertView(app.snapshot(), front, 'request starts at the actual camera');
  assert.equal(app.controls.enableDamping, false);
  app.frame(duration / 2); assertView(app.snapshot(), sample(transition(front, back), .5), 'halfway spherical camera');
  assert.equal(app.reports.length, 0, 'no tween-frame save feedback');
  app.echo(back); app.frame(duration / 2); assertView(app.snapshot(), back, 'same-id echo cannot restart animation');
  assert.equal(app.reports.length, 1); assert.equal(app.controls.enableDamping, true);
  app.frame(1000); assert.equal(app.reports.length, 1); assertView(app.snapshot(), back, 'completed transition stays put');
  app.unmount(); assert.equal(app.scene.orbitControls, undefined); assert.equal(app.canvas.count(), 0); assert.equal(app.controls.count(), 0);
}

// Fast retargeting starts from the current position, with no jump to either
// old endpoint. Pending damping is removed without moving that starting view.
{
  const app = harness(); app.controls.inertia = .75;
  app.request(back); assertView(app.snapshot(), front, 'inertia flush preserves actual start');
  assert.equal(app.controls.inertia, 0);
  app.frame(duration * .3); const actual = app.snapshot();
  const next = { position: [6, 2, 1], target: [1, 1, 1], fov: 35 };
  app.request(next); assertView(app.snapshot(), actual, 'rapid retarget preserves current sample');
  app.frame(duration / 2); assertView(app.snapshot(), sample(transition(actual, next), .5), 'retarget follows new path');
  app.frame(duration / 2); assertView(app.snapshot(), next, 'retarget finishes exactly');
  app.unmount();
}

// Snapshot captures the displayed intermediate camera, then clears both the
// transition and residual orbit inertia without moving its position or target.
{
  const app = harness(); app.request(back); app.frame(duration * .35);
  const actual = app.snapshot(), count = app.reports.length;
  app.controls.inertia = .75;
  const frozen = app.freeze();
  assertView(frozen, actual, 'freeze returns the actual displayed transition sample');
  assertView(app.snapshot(), actual, 'clearing inertia cannot change the snapshot');
  assert.equal(frozen.aspect, 16 / 9);
  assert.equal(app.controls.inertia, 0); assert.equal(app.controls.enableDamping, true);
  assert.equal(app.reports.length, count + 1, 'freezing publishes one actual-view save');
  app.frame(duration * 3); assertView(app.snapshot(), actual, 'frozen transition never resumes');
  app.controls.inertia = .5; app.freeze();
  assert.equal(app.controls.inertia, 0); assertView(app.snapshot(), actual, 'freeze also stops manual-orbit damping');
  app.unmount();
}
{
  const app = harness(); app.request(back); app.frame(duration * .2);
  const actual = app.snapshot(); app.enabled(false);
  assert.equal(app.controls.enabled, false); assertView(app.snapshot(), actual, 'disabling preserves current view');
  for (const modifier of [{ metaKey: true, ctrlKey: false }, { metaKey: false, ctrlKey: true }]) {
    app.emit(app.window, 'keydown', modifier);
    app.emit(app.window, 'keyup', { metaKey: false, ctrlKey: false });
    assert.equal(app.controls.enabled, false, 'modifier release cannot unlock the snapshot camera');
    app.emit(app.window, 'keydown', modifier); app.emit(app.window, 'blur');
    assert.equal(app.controls.enabled, false, 'window blur cannot unlock the snapshot camera');
  }
  app.frame(duration * 2); assertView(app.snapshot(), actual, 'snapshot mode stops view switching');
  app.enabled(true); assert.equal(app.controls.enabled, true, 'closing snapshot restores orbit controls');
  app.frame(duration * 2); assertView(app.snapshot(), actual, 'closing snapshot cannot resume an old transition');
  app.unmount();
}

{
  const app = harness(); app.enabled(false);
  assert.equal(app.scene.userData.orbitInputEnabled, false);
  const release = modelPointerRelease(app, false);
  for (const event of [{ type: 'pointerup', pointerId: 1, button: 0 }, { type: 'pointercancel', pointerId: 1 }, undefined]) {
    release(event); assert.equal(app.controls.enabled, false, 'Model pointerup/cancel/blur cannot unlock Snapshot');
  }
  app.enabled(true); app.controls.enabled = false;
  release(); assert.equal(app.controls.enabled, true, 'Photo mode permits orbit even though tattoo editing is disabled');
  app.unmount(); assert.equal(app.scene.userData.orbitInputEnabled, undefined, 'scene cleanup removes the external lock');
}

// Composition locks free pointer orbit, but precise external view requests
// still animate. Rendering during that animation captures its requested endpoint.
{
  const app = harness(); app.enabled(false); app.request(back);
  app.frame(duration * .3); const intermediate = app.snapshot();
  assert.ok(!equal(intermediate, front) && !equal(intermediate, back));
  app.emit(app.canvas, 'pointerdown'); app.emit(app.canvas, 'wheel');
  app.frame(duration * .2);
  assertView(app.snapshot(), sample(transition(front, back), .5), 'light-handle gestures cannot cancel composition framing');
  const frozen = app.freeze(true);
  assertView(frozen, back, 'Render finishes the requested precise camera transition');
  assert.equal(app.controls.enabled, false); assert.equal(app.controls.enableDamping, true);
  app.frame(duration * 2); assertView(app.snapshot(), back, 'captured endpoint stays fixed'); app.unmount();
}

for (const gesture of ['pointerdown', 'wheel']) {
  const app = harness(); app.request(back); app.frame(duration * .4); const actual = app.snapshot();
  app.emit(app.canvas, gesture); assert.equal(app.controls.enableDamping, true); assert.equal(app.starts, 1);
  assertView(app.reports.at(-1), actual, 'interruption saves actual stopped view');
  app.frame(duration * 2); assertView(app.snapshot(), actual, `${gesture} cancels immediately`);
  const manual = { position: [2, 1, 6], target: [0, 1, 0], fov: 45 };
  app.move(manual); assertView(app.reports.at(-1), manual, 'manual orbit still reports');
  app.frame(duration); assertView(app.snapshot(), manual, 'reported manual camera is not animated back'); app.unmount();
}

// Placement modifier locks remain in force even when an in-flight view is
// interrupted. Releasing the key/focus cannot leave orbiting stuck disabled.
{
  const app = harness(); app.request(back); app.frame(100);
  app.emit(app.window, 'keydown', { metaKey: true, ctrlKey: false }); assert.equal(app.controls.enabled, false);
  app.emit(app.canvas, 'pointerdown'); assert.equal(app.controls.enabled, false);
  app.emit(app.window, 'keyup', { metaKey: false, ctrlKey: false }); assert.equal(app.controls.enabled, true);
  app.emit(app.window, 'keydown', { metaKey: false, ctrlKey: true }); app.emit(app.window, 'blur'); assert.equal(app.controls.enabled, true);
  app.unmount(); assert.equal(app.window.count(), 0);
}

{
  const app = harness(front, { reduced: true }); app.controls.inertia = .75; app.request(back);
  assertView(app.snapshot(), back, 'reduced motion jumps directly'); assert.equal(app.controls.enableDamping, true); app.unmount();
  const live = harness(); live.request(back); live.frame(100); live.media.matches = true; live.emit(live.media, 'change');
  assertView(live.snapshot(), back, 'enabling reduced motion finishes current request'); assert.equal(live.controls.enableDamping, true); live.unmount();
}
{
  const app = harness(); app.request(back); app.frame(100); const camera = app.camera; app.unmount();
  assert.equal(app.controls.enableDamping, true, 'unmount restores controls configuration');
  const saved = { position: [2, 3, 5], target: [1, 2, 1], fov: 40 }, nextScene = harness(saved, { camera });
  assertView(nextScene.snapshot(), saved, 'new scene loads directly without animating through old scene'); nextScene.unmount();
}
{
  const app = harness(front, { explicit: false }); const manual = { position: [4, 2, 7], target: [1, 1, 0], fov: 42 };
  app.move(manual); app.echo(manual); app.frame(duration); assertView(app.snapshot(), manual, 'legacy feedback fallback stays stable');
  app.request(back); app.frame(duration); assertView(app.snapshot(), back, 'legacy caller can still request a transition'); app.unmount();
}

Object.defineProperty(globalThis, 'performance', performanceDescriptor);
delete globalThis.__cameraHooks; delete globalThis.window;
console.log('Camera transitions passed: spherical radius/shortest yaw/poles, exact eased endpoints, production component loading/retargeting, actual/frozen snapshots, disabled-camera modifier/Model-pointer locks, Photo mode orbit, no feedback loop, interrupted pointer/wheel, modifier locks, reduced motion, damping and scene/unmount cleanup.');
