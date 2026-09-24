/** Production save queue regressions; controlled storage, no browser/network. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { transform } from 'esbuild';
import ts from 'typescript';

const source = await fs.readFile(new URL('../src/storage/sceneSaveQueue.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { createSceneSaveQueue } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const tick = () => new Promise((resolve) => setImmediate(resolve));

function controlledStore() {
  const writes = [], waits = [];
  let concurrent = 0, maximumConcurrent = 0;
  return {
    writes,
    get maximumConcurrent() { return maximumConcurrent; },
    write(snapshot) {
      writes.push(snapshot);
      concurrent++; maximumConcurrent = Math.max(maximumConcurrent, concurrent);
      return new Promise((resolve, reject) => waits.push({
        resolve: () => { concurrent--; resolve(); },
        reject: (error) => { concurrent--; reject(error); },
      }));
    },
    succeed() { assert.ok(waits.length, 'a write is in progress'); waits.shift().resolve(); },
    fail(message = 'Storage is unavailable') { assert.ok(waits.length, 'a write is in progress'); waits.shift().reject(new Error(message)); },
  };
}

// Debounced edits coalesce. Navigation must wait for edits received while
// storage is busy and for other scenes sharing the same local collection.
{
  const store = controlledStore(), queue = createSceneSaveQueue(store.write.bind(store));
  const states = [], unsubscribe = queue.subscribe((state) => states.push(state));
  queue.stage({ id: 'a', anchor: 1 }); queue.stage({ id: 'a', anchor: 2 });
  assert.equal(queue.getState().status, 'pending');
  let navigated = false;
  const navigation = queue.flush().then(() => { navigated = true; });
  assert.equal(store.writes[0].anchor, 2, 'only the latest debounced edit is saved');
  assert.equal(queue.getState().status, 'saving');
  queue.stage({ id: 'a', anchor: 3 }); queue.stage({ id: 'b', anchor: 4 });
  store.succeed(); await tick();
  assert.equal(store.writes[1].anchor, 3, 'an older write cannot clear the newer edit');
  assert.equal(navigated, false);
  store.succeed(); await tick();
  assert.equal(store.writes[2].id, 'b', 'different scene writes serialize');
  assert.equal(navigated, false, 'navigation waits for every dirty scene');
  store.succeed(); await navigation;
  assert.equal(store.maximumConcurrent, 1);
  assert.equal(queue.hasPending(), false);
  assert.equal(queue.getState().status, 'saved');
  assert.equal(navigated, true);
  unsubscribe();
  assert.ok(states.some((s) => s.pendingCount === 2));
}

// Explicit Retry, without another edit, retries the retained snapshot and
// allows navigation once storage recovers. Custom lighting stays in payload.
{
  const store = controlledStore(), queue = createSceneSaveQueue(store.write.bind(store));
  const lights = [{ type: 'point', position: [1, 2, 3], color: '#ffffff', intensity: 2 }];
  const snapshot = { id: 'a', anchor: 12, lights };
  queue.stage(snapshot);
  const failed = assert.rejects(queue.flush(), /Storage is unavailable/);
  store.fail(); await failed;
  assert.equal(queue.getState().status, 'error');
  assert.equal(queue.hasPending(), true);
  assert.deepEqual(queue.peek('a'), snapshot);
  let navigated = false;
  const retried = queue.retry().then(() => { navigated = true; });
  assert.equal(store.writes.length, 2, 'retry does not reuse the rejected promise');
  assert.equal(navigated, false);
  assert.deepEqual(store.writes[1].lights, lights);
  store.succeed(); await retried;
  assert.equal(navigated, true);
  assert.deepEqual(queue.getState(), { status: 'saved', pendingCount: 0, error: null });
}

// A failure after another edit must retain the newer snapshot, and queued
// scenes must neither disappear nor bypass a failed write.
{
  const store = controlledStore(), queue = createSceneSaveQueue(store.write.bind(store));
  queue.stage({ id: 'a', anchor: 1 });
  const failed = assert.rejects(queue.flush(), /temporarily offline/);
  queue.stage({ id: 'a', anchor: 9 }); queue.stage({ id: 'b', anchor: 20 });
  store.fail('temporarily offline'); await failed;
  assert.equal(store.writes.length, 1, 'failure does not cause an automatic retry loop');
  assert.equal(queue.peek('a').anchor, 9); assert.equal(queue.peek('b').anchor, 20);
  const firstRetry = queue.retry(), secondRetry = queue.flush();
  assert.equal(firstRetry, secondRetry, 'concurrent retries share one active write');
  assert.equal(store.writes[1].anchor, 9);
  store.succeed(); await tick();
  assert.equal(store.writes[2].id, 'b');
  store.succeed(); await firstRetry;
  assert.equal(store.maximumConcurrent, 1);
}

// Unmount detaches UI observers; its best-effort flush continues until storage
// acknowledges the snapshot, without notifying the detached component.
{
  const store = controlledStore(), queue = createSceneSaveQueue(store.write.bind(store));
  let notifications = 0;
  const unsubscribe = queue.subscribe(() => notifications++);
  queue.stage({ id: 'a', anchor: 31 }); unsubscribe();
  const before = notifications, cleanupSave = queue.flush();
  assert.equal(store.writes[0].anchor, 31); assert.equal(queue.hasPending(), true);
  store.succeed(); await cleanupSave;
  assert.equal(queue.hasPending(), false); assert.equal(notifications, before);
  await queue.flush(); assert.equal(store.writes.length, 1, 'clean flush does not write again');
}

{
  let fail = true;
  const queue = createSceneSaveQueue(() => {
    if (fail) throw new Error('quota exceeded');
    return Promise.resolve();
  });
  queue.stage({ id: 'a' });
  await assert.rejects(queue.flush(), /quota exceeded/);
  assert.equal(queue.hasPending(), true);
  fail = false; await queue.retry(); assert.equal(queue.hasPending(), false);
}

// Exercise the actual Workspace save/load effects and callbacks. Extracting
// statements with TypeScript's parser keeps this a regression of production
// wiring, not a second implementation of the save behavior. Only React's hook
// scheduler, timers, canvas capture, and external dependencies are controlled.
const workspaceSource = await fs.readFile(new URL('../src/Workspace.tsx', import.meta.url), 'utf8');
const syntax = ts.createSourceFile('Workspace.tsx', workspaceSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const workspace = syntax.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === 'Workspace');
assert.ok(workspace?.body);
function bindingNames(name) {
  return ts.isIdentifier(name) ? [name.text] : name.elements.flatMap((entry) => ts.isOmittedExpression(entry) ? [] : bindingNames(entry.name));
}
// Include UI state touched by loadScene so its callback can finish in the harness.
const retainedNames = new Set(`currentScene showDashboard inspectorTab cameraPreset sceneSaves saveState saveTimer navigating stageScene flushPendingSave afterSaving
  uploadedImage decalRotation decalScale decalColor decalOpacity decalVisible surfacePlacement placementStatus photoMode background studio lightingPreset lights selectedLight
  decalPosition decalNormal cameraState bodyMeshId skinToneId poseId bodyShape bodyPose bodyAppearance isolateRegion hoverRegion panelRegions shapeMenu lookId qualityTier finalSamples
  canvasContainerRef loadScene handleBodyMeshChange`.split(/\s+/));
const extracted = workspace.body.statements.filter((statement) => {
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some((decl) => bindingNames(decl.name).some((name) => retainedNames.has(name)));
  if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression) || statement.expression.expression.getText(syntax) !== 'useEffect') return false;
  return ['sceneSaves.subscribe', "window.addEventListener('beforeunload'", 'lights: structuredClone(lights)', 'captureThumbnail(canvas, 512)'].some((text) => statement.getText(syntax).includes(text));
}).map((statement) => statement.getText(syntax));
assert.equal(extracted.filter((text) => text.startsWith('useEffect')).length, 4, 'all four production save lifecycle effects are exercised');
const cameraPresets = syntax.statements.find((s) => ts.isVariableStatement(s) && s.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === 'CAMERA_PRESETS'));
const harnessSource = `export function createComponent(deps) {
 const {useState,useRef,useEffect,useCallback,updateScene,createSceneSaveQueue,setTimeout,clearTimeout,window,document,captureThumbnail,resolveRig,migrateScene,normalizeShape,normalizePose,normalizeAppearance,normalizeStudio,findById,REGISTRY,LIGHTING_PRESETS,BACKGROUNDS}=deps;
 const DEFAULT_BODY_SHAPE={}, DEFAULT_BODY_POSE={}, DEFAULT_BODY_APPEARANCE={}, DEFAULT_STUDIO={}, FINAL_SAMPLES={default:128};
 ${cameraPresets.getText(syntax)}
 return function Component() {
 ${extracted.join('\n')}
 return {currentScene,showDashboard,saveState,decalScale,lights,surfacePlacement,decalPosition,decalNormal,decalVisible,bodyMeshId,
 bodyPose,setBodyPose,bodyAppearance,setBodyAppearance,studio,setStudio,setDecalScale,setLights,stageScene,flushPendingSave,afterSaving,loadScene,handleBodyMeshChange,canvasContainerRef,sceneSaves};
 }};`;
const harnessCode = (await transform(harnessSource, { loader: 'ts', format: 'esm' })).code;
const { createComponent } = await import(`data:text/javascript;base64,${Buffer.from(harnessCode).toString('base64')}`);

function workspaceHarness(write) {
  const hooks = [], effects = [], timers = new Map(), events = new Map();
  let cursor = 0, dirty = true, time = 0, timerId = 0, result, unmounted = false;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
  const useState = (initial) => {
    const index = cursor++;
    hooks[index] ??= { value: typeof initial === 'function' ? initial() : initial };
    return [hooks[index].value, (next) => {
      const value = typeof next === 'function' ? next(hooks[index].value) : next;
      if (!Object.is(value, hooks[index].value)) { hooks[index].value = value; if (!unmounted) dirty = true; }
    }];
  };
  const useRef = (value) => { const index = cursor++; hooks[index] ??= { current: value }; return hooks[index]; };
  const useCallback = (fn, deps) => {
    const index = cursor++;
    if (changed(hooks[index]?.deps, deps)) hooks[index] = { value: fn, deps };
    return hooks[index].value;
  };
  const useEffect = (fn, deps) => {
    const index = cursor++;
    if (changed(hooks[index]?.deps, deps)) effects.push(() => {
      hooks[index]?.cleanup?.(); hooks[index] = { deps, cleanup: fn() };
    });
  };
  const component = createComponent({
    useState, useRef, useEffect, useCallback, updateScene: write, createSceneSaveQueue,
    setTimeout: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, at: time + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    window: { addEventListener: (type, fn) => events.set(type, fn), removeEventListener: (type) => events.delete(type) },
    document: { hidden: false }, captureThumbnail: () => 'data:image/png;base64,new-thumbnail',
    resolveRig: (preset) => [{ type: 'area', intensity: 1, name: preset }],
    migrateScene: (scene) => ({ ...scene }), normalizeShape: (shape) => ({ ...shape }), normalizePose: (pose) => ({ ...pose }), normalizeAppearance: (appearance) => ({ ...appearance }), normalizeStudio: (studio) => ({ ...studio }),
    findById: (items, id) => items.find((item) => item.id === id),
    REGISTRY: { bodyMeshes: [{ id: 'body_full' }, { id: 'body_female' }], looks: [{ id: 'studio_softbox', previewLighting: 'studio' }] },
    LIGHTING_PRESETS: { studio: {}, warm: {} }, BACKGROUNDS: { white: {} },
  });
  const render = () => {
    let remaining = 50;
    while (dirty && !unmounted) {
      assert.ok(remaining-- > 0, 'Workspace save effects must converge without a render loop');
      dirty = false; cursor = 0; result = component();
      result.canvasContainerRef.current = { querySelector: () => ({}) };
      effects.splice(0).forEach((effect) => effect());
    }
  };
  const settle = async () => { await tick(); render(); await tick(); render(); };
  render();
  return {
    get state() { return result; }, settle,
    async advance(ms) {
      const target = time + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > target) break;
        time = next[1].at; timers.delete(next[0]); next[1].fn(); await settle();
      }
      time = target;
    },
    warnsBeforeUnload() {
      let warned = false;
      events.get('beforeunload')?.({ preventDefault: () => { warned = true; }, returnValue: undefined });
      return warned;
    },
    unmount() { unmounted = true; hooks.forEach((hook) => hook?.cleanup?.()); },
  };
}

function sceneFixture(id, overrides = {}) {
  return { id, name: id, decalImage: 'image', decalScale: 0.42, decalRotation: 0, decalColor: '#ffffff', decalOpacity: 1,
    decalVisible: true, surfacePlacement: { bodyMeshId: 'body_full', faceIndex: 50, barycentric: [0.2, 0.3, 0.5] },
    decalPosition: [1, 2, 3], decalNormal: [0, 0, 1], thumbnail: null, background: 'white', lightingPreset: 'studio',
    bodyMeshId: 'body_full', skinToneId: 'tone_03', poseId: 'neutral', lookId: 'studio_softbox', qualityTier: 'preview',
    bodyShape: {}, bodyPose: {}, camera: { position: [6, 4, 6], target: [0, 0, 0], fov: 45 }, ...overrides };
}

// Latest slider edits and lights are staged immediately; the real navigation
// callback blocks on failure and can be retried without another edit.
{
  const store = controlledStore(), app = workspaceHarness(store.write.bind(store));
  app.state.loadScene(sceneFixture('first')); await app.settle();
  assert.equal(app.state.showDashboard, false);
  app.state.setBodyPose({ leftElbow: 35, rightKnee: 20 });
  app.state.setStudio({ mode: 'sweep', color: '#657b91', shadow: .6, showGuides: true });
  app.state.setBodyAppearance({ top: 'tshirt', bottom: 'trousers', hairStyle: 'short', hairTone: 'brown' });
  app.state.setDecalScale(0.8); app.state.setLights([{ type: 'point', intensity: 4, position: [2, 3, 4] }]); await app.settle();
  assert.equal(app.state.sceneSaves.peek('first').decalScale, 0.8);
  assert.equal(app.warnsBeforeUnload(), true);
  await app.advance(599); assert.equal(store.writes.length, 0);
  await app.advance(1); assert.equal(store.writes[0].decalScale, 0.8);
  assert.equal(store.writes[0].lights[0].intensity, 4);
  assert.deepEqual(store.writes[0].studio, { mode: 'sweep', color: '#657b91', shadow: .6, showGuides: true });
  assert.deepEqual(store.writes[0].bodyPose, { leftElbow: 35, rightKnee: 20 });
  assert.deepEqual(store.writes[0].bodyAppearance, { top: 'tshirt', bottom: 'trousers', hairStyle: 'short', hairTone: 'brown' });
  let navigated = false;
  app.state.afterSaving(() => { navigated = true; });
  app.state.setDecalScale(1.26); await app.settle();
  store.fail('offline'); await app.settle();
  assert.equal(navigated, false, 'navigation stays in the editor after a failed save');
  assert.equal(app.state.saveState.status, 'error');
  app.state.afterSaving(() => { navigated = true; });
  assert.equal(store.writes.at(-1).decalScale, 1.26);
  store.succeed(); await app.settle();
  assert.equal(navigated, true); assert.equal(app.warnsBeforeUnload(), false);
  app.unmount();
}

// A thumbnail while an older snapshot is in flight keeps the most recent edit.
// Loading another scene waits for that complete snapshot, including lighting.
{
  const store = controlledStore(), app = workspaceHarness(store.write.bind(store));
  const customized = [{ type: 'point', intensity: 7, position: [1, 2, 3] }];
  app.state.loadScene(sceneFixture('first', { lights: customized, bodyPose: { leftElbow: 40 }, bodyAppearance: { top: 'tshirt', hairStyle: 'buzz' }, studio: { mode: 'sweep', color: '#30343c', shadow: .5 } })); await app.settle();
  assert.deepEqual(app.state.bodyPose, { leftElbow: 40 }, 'saved limb angles reload');
  assert.deepEqual(app.state.studio, { mode: 'sweep', color: '#30343c', shadow: .5 }, 'studio choices reload');
  assert.deepEqual(app.state.bodyAppearance, { top: 'tshirt', hairStyle: 'buzz' }, 'saved clothing and hair reload');
  assert.deepEqual(app.state.lights, customized); assert.notEqual(app.state.lights, customized, 'load clones custom lights');
  await app.advance(600);
  app.state.setDecalScale(0.9); await app.settle();
  await app.advance(1500);
  assert.equal(store.writes.length, 1, 'thumbnail joins the same serialized save');
  assert.equal(app.state.sceneSaves.peek('first').decalScale, 0.9);
  assert.equal(app.state.sceneSaves.peek('first').thumbnail, 'data:image/png;base64,new-thumbnail');
  app.state.loadScene(sceneFixture('second', { lightingPreset: 'warm' }));
  assert.equal(app.state.currentScene.id, 'first');
  store.succeed(); await app.settle();
  assert.equal(store.writes[1].decalScale, 0.9); assert.deepEqual(store.writes[1].lights, customized);
  store.succeed(); await app.settle();
  assert.equal(app.state.currentScene.id, 'second'); assert.equal(app.state.lights[0].name, 'warm', 'legacy scene loads its preset rig');
  app.state.handleBodyMeshChange('body_female'); await app.settle();
  assert.equal(app.state.bodyMeshId, 'body_female'); assert.equal(app.state.decalScale, 0.42, 'changing bodies preserves design size');
  for (const field of ['surfacePlacement', 'decalPosition', 'decalNormal']) assert.equal(app.state[field], null, `${field} cannot carry to another body`);
  assert.equal(app.state.decalVisible, false);
  app.unmount();
  assert.equal(store.writes[2].bodyMeshId, 'body_female', 'production cleanup flushes pending changes');
  store.succeed(); await app.settle();
  assert.equal(app.state.sceneSaves.hasPending(), false);
}

console.log('Scene save checks passed: production queue and Workspace lifecycle, debounce, navigation/retry, cross-scene serialization, concurrent edits/thumbnails, custom-light reload, model change, beforeunload, unmount flush.');
