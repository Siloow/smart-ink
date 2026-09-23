import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const { outputFiles } = await build({
  stdin: { contents: "export * from './src/services/editorHistory'; export * from './src/hooks/useEditorHistory';", resolveDir: project },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'controlled-react', setup(builder) {
    builder.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
      export const useRef=(...args)=>globalThis.__historyHooks.useRef(...args);
      export const useCallback=(...args)=>globalThis.__historyHooks.useCallback(...args);
      export const useLayoutEffect=(...args)=>globalThis.__historyHooks.useLayoutEffect(...args);
      export const useSyncExternalStore=(...args)=>globalThis.__historyHooks.useSyncExternalStore(...args);
    ` }));
  } }],
});
const { createEditorHistory, equalEditorSnapshot, useEditorHistory } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const snap = (size = 1, extra = {}) => ({ tattoo: { size, opacity: 0, placement: null }, title: '', visible: false, ...extra });

// Equality preserves deliberate empty, null and zero values, without serializing images.
assert.equal(equalEditorSnapshot(snap(), snap()), true);
for (const changed of [snap(2), snap(1, { title: null }), snap(1, { visible: 0 }), snap(1, { extra: undefined })]) {
  assert.equal(equalEditorSnapshot(snap(), changed), false);
}
assert.equal(equalEditorSnapshot([1, 2], { 0: 1, 1: 2 }), false);
assert.equal(equalEditorSnapshot({ a: undefined }, { b: undefined }), false);
assert.equal(equalEditorSnapshot({ a: NaN }, { a: NaN }), true);

{
  const source = `data:image/png;base64,${'a'.repeat(5_000_000)}`;
  const initial = snap(1, { source });
  const history = createEditorHistory(initial);
  let publications = 0;
  const unsubscribe = history.subscribe(() => publications++);
  const initialState = history.getState();
  assert.equal(history.observe(snap(1, { source })), false);
  assert.equal(history.getState(), initialState, 'no-op preserves the external-store snapshot');
  for (let size = 2; size <= 4; size++) history.observe(snap(size, { source }));
  assert.equal(history.getState().undoCount, 3);
  assert.equal(history.undo(), true);
  assert.equal(history.getState().value.tattoo.size, 3);
  assert.equal(history.getState().value.source, source);
  history.undo(); history.undo();
  assert.equal(history.getState().value, initial, 'snapshots are held by reference');
  assert.equal(history.undo(), false);
  history.redo();
  assert.equal(history.getState().value.tattoo.size, 2);
  history.observe(snap(8, { source }));
  assert.equal(history.getState().canRedo, false, 'a new branch removes abandoned future');
  assert.equal(history.redo(), false);
  const observed = publications;
  unsubscribe(); history.reset(initial);
  assert.equal(publications, observed);
  assert.equal(history.getState().canUndo, false);
  assert.equal(history.getState().canRedo, false);
}

// Hundreds of slider/drag updates occupy one entry; undo also closes a pending drag.
for (const finish of ['endGesture', 'flush', 'undo']) {
  const history = createEditorHistory(snap());
  history.beginGesture(); history.beginGesture();
  for (let size = 2; size <= 400; size++) history.observe(snap(size));
  assert.equal(history.getState().undoCount, 1);
  history[finish]();
  assert.equal(history.getState().gestureActive, false);
  if (finish !== 'undo') history.undo();
  assert.deepEqual(history.getState().value, snap());
  assert.equal(history.getState().canUndo, false);
  history.redo();
  assert.deepEqual(history.getState().value, snap(400));
  history.endGesture();
  assert.equal(history.getState().undoCount, 1, 'duplicate finish is harmless');
}

// A cancelled/no-op gesture preserves redo, including radial Escape restoring start.
{
  const history = createEditorHistory(snap());
  history.observe(snap(2)); history.undo();
  history.beginGesture(); history.observe(snap(3));
  assert.equal(history.getState().canRedo, false);
  history.observe(snap()); history.endGesture();
  assert.equal(history.getState().canUndo, false);
  assert.equal(history.getState().canRedo, true);
  history.redo(); assert.deepEqual(history.getState().value, snap(2));
  history.beginGesture(); history.endGesture();
  assert.equal(history.getState().undoCount, 1);
  history.undo(); history.beginGesture(); history.observe(snap(9));
  assert.equal(history.redo(), false, 'redo cannot abandon a changed, uncommitted gesture');
  assert.deepEqual(history.getState().value, snap(9));
}

// Capacity and reset always bound history; reset drops a gesture and its old scene.
{
  const defaultHistory = createEditorHistory(0);
  for (let i = 1; i <= 100; i++) defaultHistory.observe(i);
  assert.equal(defaultHistory.getState().undoCount, 60);
  while (defaultHistory.undo()) { /* Walk the bounded stack. */ }
  assert.equal(defaultHistory.getState().value, 40);
  const history = createEditorHistory(0, { limit: 3 });
  for (let i = 1; i <= 12; i++) history.observe(i);
  assert.equal(history.getState().undoCount, 3);
  history.undo(); history.undo(); history.undo();
  assert.equal(history.getState().value, 9);
  assert.equal(history.undo(), false);
  history.redo(); history.redo(); history.redo();
  assert.equal(history.getState().value, 12);
  history.beginGesture(); history.observe(20); history.reset(100);
  assert.equal(history.getState().gestureActive, false);
  assert.equal(history.undo(), false); assert.equal(history.redo(), false);
  assert.equal(history.getState().value, 100);
}

// Exercise the production hook with controlled React commits/effects. This makes
// restore scheduling, scope changes and handlers fired before layout testable.
function harness(initial = snap()) {
  const hooks = []; let cursor = 0, effects = [], output;
  let props = { value: initial, scopeId: 'first-scene', enabled: true };
  const restores = [];
  let scheduledRestore;
  const onRestore = value => { restores.push(value); scheduledRestore = value; };
  const sameDeps = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  globalThis.__historyHooks = {
    useRef(value) { const index = cursor++; return hooks[index] ??= { current: value }; },
    useCallback(callback, deps) {
      const index = cursor++; if (!sameDeps(hooks[index]?.deps, deps)) hooks[index] = { callback, deps };
      return hooks[index].callback;
    },
    useLayoutEffect(callback, deps) {
      const index = cursor++;
      if (!sameDeps(hooks[index]?.deps, deps)) { hooks[index] = { deps }; effects.push(callback); }
    },
    useSyncExternalStore(_subscribe, getSnapshot) { cursor++; return getSnapshot(); },
  };
  const flush = () => { const pending = effects; effects = []; pending.forEach(callback => callback()); };
  const render = (patch = {}, runEffects = true) => {
    props = { ...props, ...patch }; cursor = 0;
    output = useEditorHistory({ ...props, onRestore });
    if (runEffects) flush();
    return output;
  };
  render();
  return { render, flush, restores, get api() { return output; }, get value() { return props.value; },
    commit() { if (scheduledRestore !== undefined) { const value = scheduledRestore; scheduledRestore = undefined; render({ value }); } },
  };
}

{
  const app = harness();
  app.render({ value: snap(2) }); app.render();
  assert.equal(app.api.canUndo, true);
  app.render({ value: snap(3) }, false);
  app.api.undo();
  assert.deepEqual(app.restores.at(-1), snap(2), 'undo synchronizes render not yet observed by layout');
  app.api.undo();
  assert.deepEqual(app.restores.at(-1), snap(), 'second immediate undo does not re-record pre-restore UI');
  app.commit(); app.render();
  assert.equal(app.api.canUndo, false);
  assert.equal(app.api.canRedo, true);
  app.api.redo(); app.api.redo(); app.commit(); app.render();
  assert.deepEqual(app.value, snap(3));
  assert.equal(app.api.canRedo, false);
  assert.equal(app.api.canUndo, true);
}
{
  const app = harness();
  app.api.beginGesture();
  for (let size = 2; size <= 100; size++) app.render({ value: snap(size) });
  app.api.endGesture(); app.api.undo(); app.commit(); app.render();
  assert.deepEqual(app.value, snap());
  assert.equal(app.api.canUndo, false);
  app.api.redo(); app.commit();
  assert.deepEqual(app.value, snap(100));
  app.render({ scopeId: 'second-scene', value: snap(50) }, false);
  app.api.undo();
  assert.equal(app.restores.length, 2, 'scope change is synchronized before undo and cannot restore another scene');
  app.flush(); app.render();
  assert.equal(app.api.canUndo, false); assert.equal(app.api.canRedo, false);
  app.render({ value: snap(51) }); app.render({ enabled: false }); app.api.undo();
  assert.equal(app.restores.length, 2);
  app.render({ enabled: true }); app.render();
  assert.equal(app.api.canUndo, false, 'disabled scene does not accumulate edits');
  app.render({ value: snap(52) }); app.api.reset(); app.api.undo();
  assert.equal(app.restores.length, 2);
}
delete globalThis.__historyHooks;
console.log('Editor history passed: immutable snapshots, large image sharing, exact empty values, 60-entry default/bounded history, branching, gesture coalescing/no-op cancellation, pending drag undo, React replay, pre-layout undo, repeated commands, scene boundaries and disabled/reset behavior.');
