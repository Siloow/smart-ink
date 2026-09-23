/** Real React markup and production handlers; this is not a browser click-through. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const root = fileURLToPath(new URL('../', import.meta.url));
const workspace = ts.createSourceFile('Workspace.tsx', await fs.readFile(path.join(root, 'src/Workspace.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let cameraDeclaration;
for (const statement of workspace.statements) if (ts.isVariableStatement(statement)) {
  for (const declaration of statement.declarationList.declarations) if (declaration.name.getText(workspace) === 'CAMERA_PRESETS') cameraDeclaration = declaration.getText(workspace);
}
assert.ok(cameraDeclaration, 'Use the camera choices actually exposed by Workspace');
const source = `export {default as ViewportControls} from './src/ViewportControls.tsx';export {BODY_REGIONS, regionLabel} from './src/render/bodyRegions.ts';export const ${cameraDeclaration};`;
const temporary = path.join(root, `tools/.viewport-controls-${process.pid}.mjs`);
let real;
try {
  await build({ stdin: { contents: source, resolveDir: root, loader: 'ts' }, outfile: temporary,
    bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', external: ['react', 'react/jsx-runtime'], logLevel: 'silent' });
  real = await import(pathToFileURL(temporary));
} finally { await fs.rm(temporary, { force: true }); }
const noop = () => {};
const common = { cameras: real.CAMERA_PRESETS, cameraPreset: 'front', onCameraChange: noop, region: null,
  onRegionChange: noop, onHighlightRegions: noop, onFit: noop, onCleanView: noop,
  performanceMode: false, onPerformanceChange: noop };
for (const region of [null, ...real.BODY_REGIONS.map(part => part.id)]) {
  const html = renderToStaticMarkup(React.createElement(real.ViewportControls, { ...common, region }));
  assert.ok(html.includes('aria-label="Viewport controls"'));
  assert.ok(html.includes('Clean view') && html.includes('Viewport settings') && html.includes('Faster preview'));
  assert.ok(html.includes('Blender renders keep their selected quality.'));
  assert.equal((html.match(/<select\b/g) ?? []).length, 2);
  for (const camera of Object.values(real.CAMERA_PRESETS)) assert.ok(html.includes(camera.name));
  for (const part of real.BODY_REGIONS) assert.ok(html.includes(`<option value="${part.id}"`));
  assert.equal(html.includes('Return to full figure'), region !== null);
  if (region) {
    assert.ok(html.includes(`<strong>${real.regionLabel(region)}</strong>`));
    assert.ok(html.includes('Other body areas and clothes are hidden.'));
  }
}
assert.ok(renderToStaticMarkup(React.createElement(real.ViewportControls, { ...common, disabled: true })).includes('inert=""'));
assert.ok(renderToStaticMarkup(React.createElement(real.ViewportControls, { ...common, cameraPreset: 'custom' })).includes('value="custom" selected="">Custom view</option>'));

const { outputFiles } = await build({ stdin: { contents: source, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', logLevel: 'silent',
  plugins: [{ name: 'viewport-handlers', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'hooks' }));
    builder.onLoad({ filter: /.*/, namespace: 'hooks' }, args => ({ contents: args.path === 'react'
      ? 'export const useId=()=>"viewport-test";export const useRef=v=>globalThis.__viewportHooks.ref(v);export const useEffect=(fn,deps)=>globalThis.__viewportHooks.effect(fn,deps);'
      : 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";' }));
    builder.onResolve({ filter: /^react-icons\/fa$/ }, () => ({ path: 'icons', namespace: 'stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const FaExpand="expand",FaSlidersH="sliders",FaRegEye="eye";' }));
  } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const calls = [], refs = [], effects = [], cleanup = [], listeners = new Map();
let cursor = 0, effectCursor = 0, summaryFocused = false;
const originalDocument = globalThis.document;
globalThis.document = {
  addEventListener(name, callback) { assert.ok(!listeners.has(name), `Duplicate ${name} listener`); listeners.set(name, callback); },
  removeEventListener(name, callback) { assert.equal(listeners.get(name), callback); listeners.delete(name); },
};
globalThis.__viewportHooks = {
  ref(value) { const index = cursor++; return refs[index] ??= { current: value }; },
  effect(fn) { const index = effectCursor++; if (!effects[index]) { effects[index] = fn; cleanup.push(fn()); } },
};
const inside = {}, outside = {};
const settingsDom = { open: false, contains: target => target === inside,
  querySelector: selector => selector === 'summary' ? { focus() { summaryFocused = true; } } : null };
const props = { ...common,
  onCameraChange: value => { calls.push(['camera', value]); props.cameraPreset = value; },
  onRegionChange: value => { calls.push(['region', value]); props.region = value; },
  onHighlightRegions: value => calls.push(['highlight', value]),
  onFit: () => calls.push(['fit']), onCleanView: () => calls.push(['clean']),
  onPerformanceChange: value => { calls.push(['performance', value]); props.performanceMode = value; },
};
const flatten = (node, all = []) => {
  if (Array.isArray(node)) node.forEach(child => flatten(child, all));
  else if (node && typeof node === 'object') { all.push(node); flatten(node.props?.children, all); }
  return all;
};
const content = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(content).join('') : node?.props ? content(node.props.children) : '';
function nodes() {
  cursor = 0; effectCursor = 0;
  const all = flatten(api.ViewportControls(props));
  all.find(node => node.type === 'details').props.ref.current = settingsDom;
  return all;
}
const select = suffix => nodes().find(node => node.type === 'select' && node.props.id.endsWith(suffix));
const button = label => nodes().find(node => node.type === 'button' && content(node) === label);
const settings = () => nodes().find(node => node.type === 'details');
try {
  for (const key of Object.keys(real.CAMERA_PRESETS)) {
    select('-view').props.onChange({ currentTarget: { value: key } });
    assert.deepEqual(calls.at(-1), ['camera', key]);
    assert.equal(select('-view').props.value, key);
  }
  for (const key of ['front', 'back', 'left', 'right']) {
    button(key[0].toUpperCase() + key.slice(1)).props.onClick();
    assert.equal(button(key[0].toUpperCase() + key.slice(1)).props['aria-pressed'], true);
    assert.deepEqual(calls.at(-1), ['camera', key]);
  }
  props.cameraPreset = 'custom';
  assert.ok(nodes().some(node => node.type === 'option' && node.props.value === 'custom' && content(node) === 'Custom view'));
  const originalCameras = props.cameras;
  props.cameras = { front: originalCameras.front };
  assert.ok(button('Front')); assert.equal(button('Back'), undefined, 'Only available views receive shortcuts');
  props.cameras = originalCameras;
  for (const region of real.BODY_REGIONS) {
    select('-focus').props.onChange({ currentTarget: { value: region.id } });
    assert.deepEqual(calls.slice(-2), [['region', region.id], ['highlight', []]]);
    assert.ok(content(nodes().find(node => node.props?.role === 'status')).includes(region.label));
    select('-focus').props.onMouseEnter(); assert.deepEqual(calls.at(-1), ['highlight', [region.id]]);
    select('-focus').props.onMouseLeave(); assert.deepEqual(calls.at(-1), ['highlight', []]);
    assert.ok(button('Fit').props.title.toLowerCase().includes(region.label.toLowerCase()));
    button('Fit').props.onClick(); assert.deepEqual(calls.at(-1), ['fit']);
    button('Return to full figure').props.onClick();
    assert.equal(props.region, null); assert.deepEqual(calls.slice(-2), [['region', null], ['highlight', []]]);
    assert.equal(button('Return to full figure'), undefined);
  }
  props.region = 'armLeft'; select('-focus').props.onChange({ currentTarget: { value: 'full' } });
  assert.equal(props.region, null); assert.deepEqual(calls.at(-1), ['highlight', []]);
  select('-focus').props.onMouseEnter(); assert.deepEqual(calls.at(-1), ['highlight', []]);
  button('Clean view').props.onClick(); assert.deepEqual(calls.at(-1), ['clean']);
  const beforePerformance = { region: props.region, camera: props.cameraPreset, cameras: structuredClone(props.cameras) };
  for (const enabled of [true, false]) {
    nodes().find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ currentTarget: { checked: enabled } });
    assert.deepEqual(calls.at(-1), ['performance', enabled]);
    assert.equal(nodes().find(node => node.type === 'input').props.checked, enabled);
    assert.deepEqual({ region: props.region, camera: props.cameraPreset, cameras: props.cameras }, beforePerformance, 'Preview quality delegates only its own preference');
  }
  settingsDom.open = true; listeners.get('pointerdown')({ target: inside }); assert.equal(settingsDom.open, true);
  listeners.get('pointerdown')({ target: outside }); assert.equal(settingsDom.open, false);
  const escape = () => ({ key: 'Escape', preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } });
  const closed = escape(); settings().props.onKeyDown(closed); assert.ok(!closed.prevented && !closed.stopped);
  settingsDom.open = true;
  const unrelated = { key: 'ArrowDown' }; settings().props.onKeyDown(unrelated); assert.equal(settingsDom.open, true);
  const opened = escape(); settings().props.onKeyDown(opened);
  assert.equal(settingsDom.open, false); assert.ok(opened.prevented && opened.stopped && summaryFocused);
  props.disabled = true; assert.equal(nodes()[0].props.inert, true);
  assert.equal(listeners.size, 1, 'A rerender does not add a duplicate global pointer handler');
} finally {
  cleanup.forEach(fn => fn?.());
  assert.equal(listeners.size, 0, 'Unmount removes global listeners');
  delete globalThis.__viewportHooks;
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
}
console.log(`Viewport controls passed: real markup, ${Object.keys(real.CAMERA_PRESETS).length} views, six focus regions, shortcuts, fit, clean view, preview-only settings, outside/Escape dismissal, focus restoration and inert state.`);
