import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const { outputFiles } = await build({ stdin: { contents: "export * from './src/services/editorHistoryBindings'; export * from './src/services/editorHistory';", resolveDir: project }, bundle: true, platform: 'node', format: 'esm', write: false });
const { bindEditorHistory, isNativeUndoTarget, createEditorHistory } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

class FakeTarget {
  constructor(tag = 'div', attrs = {}, parent = null) { this.tag = tag; this.attrs = attrs; this.parent = parent; this.listeners = new Map(); }
  addEventListener(type, callback, capture = false) {
    const list = this.listeners.get(type) ?? [];
    list.push({ callback, capture }); this.listeners.set(type, list);
  }
  removeEventListener(type, callback, capture = false) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(item => item.callback !== callback || item.capture !== capture));
  }
  emit(type, props = {}) {
    const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...props };
    [...(this.listeners.get(type) ?? [])].forEach(({ callback }) => callback(event));
    return event;
  }
  contains(node) { for (let next = node; next; next = next.parent) if (next === this) return true; return false; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  matches(selector) {
    if (selector === '.sl-map [role="button"]') return this.attrs.role === 'button' && Boolean(this.parent?.closest('.sl-map'));
    if (selector.startsWith('input:not(')) return this.tag === 'input' && ![...selector.matchAll(/\[type="([^"]+)"\]/g)].some(match => this.attrs.type === match[1]);
    if (selector.startsWith('.')) return (this.attrs.class ?? '').split(' ').includes(selector.slice(1));
    const attr = selector.match(/^(\w+)?\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attr) return (!attr[1] || attr[1] === this.tag) && Object.hasOwn(this.attrs, attr[2]) && (attr[3] === undefined || this.attrs[attr[2]] === attr[3]);
    return this.tag === selector;
  }
  closest(selectors) {
    for (let next = this; next; next = next.parent) if (selectors.split(',').some(selector => next.matches(selector.trim()))) return next;
    return null;
  }
  get listenerCount() { return [...this.listeners.values()].reduce((count, list) => count + list.length, 0); }
}

function setup() {
  const root = new FakeTarget(), host = new FakeTarget('window');
  const frames = new Map(); let frameId = 0, begins = 0, ends = 0, undoCalls = 0, redoCalls = 0;
  host.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  host.cancelAnimationFrame = id => frames.delete(id);
  const history = createEditorHistory({ value: 0 });
  const commands = {
    blocked: false,
    beginGesture() { begins++; history.beginGesture(); },
    endGesture() { ends++; history.endGesture(); },
    undo() { undoCalls++; history.undo(); },
    redo() { redoCalls++; history.redo(); },
  };
  const cleanup = bindEditorHistory(root, host, () => commands);
  const node = (tag, attrs = {}, parent = root) => new FakeTarget(tag, attrs, parent);
  return { root, host, node, commands, history, cleanup,
    frame() { const work = [...frames.values()]; frames.clear(); work.forEach(callback => callback()); },
    get pendingFrames() { return frames.size; }, get begins() { return begins; }, get ends() { return ends; },
    get undoCalls() { return undoCalls; }, get redoCalls() { return redoCalls; },
    update(value) { history.observe({ value }); },
    down(target, pointerId = 7, button = 0) { root.emit('pointerdown', { target, pointerId, button }); },
    up(pointerId = 7) { host.emit('pointerup', { pointerId }); },
    key(key, target = root, extra = {}) { return host.emit('keydown', { key, target, ...extra }); },
  };
}

// Native text/number/color edits keep browser undo; scene controls use scene undo.
{
  const app = setup();
  for (const type of ['text', 'number', 'color', 'email', 'search']) assert.equal(isNativeUndoTarget(app.node('input', { type })), true);
  assert.equal(isNativeUndoTarget(app.node('input')), true);
  assert.equal(isNativeUndoTarget(app.node('textarea')), true);
  for (const type of ['range', 'checkbox', 'radio', 'button', 'submit']) assert.equal(isNativeUndoTarget(app.node('input', { type })), false);
  const editable = app.node('div', { contenteditable: 'true' });
  assert.equal(isNativeUndoTarget(app.node('span', {}, editable)), true);
  const noneditable = app.node('div', { contenteditable: 'false' }, editable);
  assert.equal(isNativeUndoTarget(app.node('span', {}, noneditable)), false);
  assert.equal(isNativeUndoTarget(null), false);
  app.cleanup();
}

// Every drag surface coalesces a continuous edit; right-drag radial shape uses canvas.
for (const kind of ['canvas', 'range', 'color', 'light-map', 'right-drag', 'custom']) {
  const app = setup();
  const target = kind === 'range' || kind === 'color' ? app.node('input', { type: kind })
    : kind === 'light-map' ? app.node('circle', {}, app.node('svg', { class: 'sl-map' }))
    : kind === 'custom' ? app.node('div', { 'data-history-gesture': '' }) : app.node('canvas');
  app.down(target, 7, kind === 'right-drag' ? 2 : 0);
  for (let i = 1; i <= 20; i++) app.update(i);
  app.host.emit('pointerup', { pointerId: 100 });
  assert.equal(app.pendingFrames, 0, `${kind}: unrelated pointer cannot end drag`);
  app.up();
  assert.equal(app.history.getState().gestureActive, true);
  app.update(21); // Model's native pointerup commit arrives after root's handler.
  app.frame();
  assert.equal(app.history.getState().gestureActive, false);
  assert.equal(app.history.getState().undoCount, 1);
  app.history.undo(); assert.deepEqual(app.history.getState().value, { value: 0 });
  app.history.redo(); assert.deepEqual(app.history.getState().value, { value: 21 });
  app.cleanup();
}

// A second control clicked before the first deferred frame still gets its own entry.
{
  const app = setup(), range = app.node('input', { type: 'range' });
  app.down(range); app.update(1); app.up();
  app.down(range); app.update(2); app.up(); app.frame();
  assert.equal(app.history.getState().undoCount, 2);
  app.history.undo(); assert.deepEqual(app.history.getState().value, { value: 1 });
  app.cleanup();
}

// Exact-value drafts commit on blur; preset/reset clicks must form another edit.
{
  const app = setup(), number = app.node('input', { type: 'text' }), preset = app.node('button');
  app.root.emit('focusin', { target: number });
  app.update(1); app.update(2); // optional arrow nudges while the exact field is focused
  app.down(preset);
  app.update(3); // React onBlur commits the typed draft.
  app.root.emit('focusout', { target: number });
  app.root.emit('click', { target: preset });
  app.update(10); // button onClick applies the preset before RAF.
  app.frame();
  assert.equal(app.history.getState().undoCount, 2);
  app.history.undo(); assert.deepEqual(app.history.getState().value, { value: 3 });
  app.history.undo(); assert.deepEqual(app.history.getState().value, { value: 0 });
  app.cleanup();
}

// A range/map drag following a draft waits until after blur, before its first edit.
for (const firstEvent of ['input', 'pointermove', 'pointerup']) {
  const app = setup(), number = app.node('input', { type: 'number' }), range = app.node('input', { type: 'range' });
  app.root.emit('focusin', { target: number }); app.update(1);
  app.down(range);
  app.update(2); // React's final numeric blur commit.
  app.root.emit('focusout', { target: number });
  if (firstEvent === 'input') app.root.emit('input', { target: range });
  else app.host.emit(firstEvent, { pointerId: 7, target: range });
  app.update(3);
  app.up(); app.frame();
  assert.equal(app.history.getState().undoCount, 2, firstEvent);
  app.history.undo(); assert.deepEqual(app.history.getState().value, { value: 2 });
  app.history.undo(); assert.deepEqual(app.history.getState().value, { value: 0 });
  app.cleanup();
}

// Repeated range and accessible light-map arrow keys form one operation per hold.
for (const kind of ['range', 'light-map']) {
  const app = setup(), target = kind === 'range' ? app.node('input', { type: 'range' })
    : app.node('circle', {}, app.node('g', { role: 'button' }, app.node('svg', { class: 'sl-map' })));
  for (let i = 1; i <= 12; i++) { app.key('ArrowRight', target, { repeat: i > 1 }); app.update(i); }
  assert.equal(app.begins, 1);
  app.host.emit('keyup', { key: 'ArrowLeft', target }); assert.equal(app.pendingFrames, 0);
  app.host.emit('keyup', { key: 'ArrowRight', target }); app.update(13); app.frame();
  assert.equal(app.history.getState().undoCount, 1);
  app.key('ArrowLeft', target); app.update(11); app.host.emit('keyup', { key: 'ArrowLeft', target }); app.frame();
  assert.equal(app.history.getState().undoCount, 2);
  app.cleanup();
}

// Cmd/Ctrl shortcuts, native-field ownership, modal blocking and latest commands.
{
  const app = setup(); app.update(1); app.update(2);
  assert.equal(app.key('z', app.root, { metaKey: true }).defaultPrevented, true);
  assert.deepEqual(app.history.getState().value, { value: 1 });
  app.key('Z', app.root, { metaKey: true, shiftKey: true });
  assert.deepEqual(app.history.getState().value, { value: 2 });
  app.key('z', app.root, { ctrlKey: true }); app.key('y', app.root, { ctrlKey: true });
  assert.deepEqual(app.history.getState().value, { value: 2 });
  assert.equal(app.undoCalls, 2); assert.equal(app.redoCalls, 2);
  for (const target of [app.node('input', { type: 'number' }), app.node('input', { type: 'text' }), app.node('textarea'), app.node('div', { contenteditable: '' })]) {
    assert.equal(app.key('z', target, { ctrlKey: true }).defaultPrevented, false);
    assert.equal(app.key('y', target, { ctrlKey: true }).defaultPrevented, false);
  }
  app.commands.blocked = true;
  assert.equal(app.key('z', app.root, { ctrlKey: true }).defaultPrevented, false);
  app.down(app.node('input', { type: 'range' })); assert.equal(app.begins, 0);
  app.commands.gesturesBlocked = false; // Snapshot disables Undo but still edits lights.
  const range = app.node('input', { type: 'range' });
  app.down(range); app.update(3); app.update(4); app.up(); app.frame();
  assert.equal(app.history.getState().undoCount, 3);
  app.key('ArrowRight', range); app.update(5); app.update(6);
  app.host.emit('keyup', { key: 'ArrowRight' }); app.frame();
  assert.equal(app.history.getState().undoCount, 4);
  app.commands.blocked = false; app.commands.gesturesBlocked = true;
  app.key('ArrowRight', range); assert.equal(app.begins, 2);
  app.key('z', app.root, { ctrlKey: true, altKey: true });
  app.key('z', app.root, { ctrlKey: true, defaultPrevented: true });
  assert.equal(app.undoCalls, 2);
  app.cleanup();
}

// Pointer cancellation, window blur, active-pointer command rejection, cleanup.
for (const endEvent of ['pointercancel', 'blur']) {
  const app = setup(), range = app.node('input', { type: 'range' });
  app.down(range); app.update(1);
  app.down(range, 100); assert.equal(app.begins, 1, 'unrelated pointer cannot restart history');
  assert.equal(app.key('z', app.root, { ctrlKey: true }).defaultPrevented, false);
  app.host.emit(endEvent, { pointerId: 7 }); app.update(2); app.frame();
  app.key('z', app.root, { ctrlKey: true });
  assert.deepEqual(app.history.getState().value, { value: 0 });
  app.down(range); app.update(3); app.up(); assert.equal(app.pendingFrames, 1);
  const beforeCleanup = app.ends;
  app.cleanup();
  assert.equal(app.pendingFrames, 0); assert.equal(app.root.listenerCount, 0); assert.equal(app.host.listenerCount, 0);
  app.frame(); app.key('z', app.root, { ctrlKey: true });
  assert.equal(app.ends, beforeCleanup, 'disposed bindings do not invoke commands later');
}
console.log('Editor history bindings passed: canvas/range/color/light-map/right-drag grouping, final commit before RAF, draft blur/preset boundaries, following drags, wrong pointers, keyboard repeats and shortcuts, native input undo, independent modal command/gesture guards, cancellation, blur and cleanup.');
