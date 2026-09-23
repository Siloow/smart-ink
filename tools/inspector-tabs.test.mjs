import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const root = fileURLToPath(new URL('../', import.meta.url));
const { outputFiles } = await build({
  stdin: { contents: "export { default as TopMenuBar } from './src/TopMenuBar';", resolveDir: root },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
  plugins: [{ name: 'inspector-handlers', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'hooks' }));
    builder.onLoad({ filter: /.*/, namespace: 'hooks' }, args => ({ contents: args.path === 'react'
      ? 'export const useId=()=>globalThis.__inspector.id();export const useRef=v=>globalThis.__inspector.ref(v);export const useState=v=>globalThis.__inspector.state(v);export const useEffect=(fn,deps)=>globalThis.__inspector.effect(fn,deps);'
      : 'export const jsx=(type,props,key)=>({type,props,key});export const jsxs=jsx;export const Fragment="fragment";' }));
    builder.onResolve({ filter: /^react-icons\/fa$/ }, () => ({ path: 'icons', namespace: 'stub' }));
    builder.onResolve({ filter: /\/utils\/tattooUpload$/ }, () => ({ path: 'upload', namespace: 'stub' }));
    builder.onResolve({ filter: /^\.\/(PoseControls|AppearanceControls|StudioControls|CharacterBuilderSections|LightingControls|AdjustmentControl)$/ }, args => ({ path: args.path.slice(2), namespace: 'stub' }));
    builder.onLoad({ filter: /.*/, namespace: 'stub' }, args => ({ contents: args.path === 'icons'
      ? 'export const FaUpload="upload",FaUndo="undo",FaRegImage="image";'
      : args.path === 'upload' ? 'export const readTattooPng=(...args)=>globalThis.__inspectorRead(...args);'
        : `export default ${JSON.stringify(args.path)};` }));
  } }],
});
const { TopMenuBar } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
let cursor = 0, effects = [], idCounter = 0, focus = null;
const slots = [], dom = new Map(), calls = [];
globalThis.__inspector = {
  id() { const index = cursor++; return slots[index] ??= `inspector-${++idCounter}`; },
  ref(value) { const index = cursor++; return slots[index] ??= { current: value }; },
  state(value) { const index = cursor++; slots[index] ??= { value: typeof value === 'function' ? value() : value };
    return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; }]; },
  effect(fn, deps) { const index = cursor++, prev = slots[index];
    if (!prev || !deps || deps.some((dep, i) => !Object.is(dep, prev.deps[i]))) effects.push(fn);
    slots[index] = { deps };
  },
};
const props = {
  disabled: false, bodyMeshId: 'male', onBodyMeshChange: value => calls.push(['body', value]),
  skinToneId: 'medium', lookId: 'studio', onSkinChange() {}, onLookChange() {}, bodyShape: {}, onBodyShapeChange() {},
  bodyAppearance: {}, onAppearanceChange() {}, background: 'white', onBackgroundChange: value => calls.push(['background', value]), studio: { showGuides: false }, onStudioChange: value => calls.push(['studio', value]),
  bodyPose: {}, poseId: 'neutral', onPosePresetChange() {}, onBodyPoseChange() {}, onFramePose() {},
  isolateRegion: null, onIsolateRegionChange() {}, onHighlightRegions: value => calls.push(['highlight', value]),
  uploadedImage: null, setUploadedImage: value => { props.uploadedImage = value; calls.push(['image', value]); },
  hasPlacement: false, decalVisible: true, decalRotation: 0, decalScale: 1, decalOpacity: 1, decalColor: '#ffffff',
  onDecalScaleChange: value => calls.push(['size', value]), onDecalRotationChange: value => calls.push(['rotation', value]),
  onDecalOpacityChange: value => calls.push(['opacity', value]), onDecalColorChange: value => calls.push(['tint', value]),
  onDecalVisibleChange: value => { props.decalVisible = value; calls.push(['visible', value]); }, onDecalReset: () => calls.push(['reset']),
  lights: [], selectedLight: null, lightingPreset: 'studio', onLightingPresetChange() {}, onSelectLight() {},
  onLightsChange: value => calls.push(['lights', value]),
};
function descendants(node, result = []) {
  if (Array.isArray(node)) node.forEach(child => descendants(child, result));
  else if (node && typeof node === 'object') { result.push(node); descendants(node.props?.children, result); }
  return result;
}
function render() {
  cursor = 0; effects = [];
  const all = descendants(TopMenuBar(props));
  for (const node of all) {
    const ref = node.props?.ref;
    if (!ref) continue;
    const key = node.props.id || (node.props.type === 'file' ? 'file-picker' : null);
    if (!key) continue;
    if (!dom.has(key)) dom.set(key, { scrollTop: 0, focus: () => { focus = key; }, click: () => calls.push(['picker']) });
    if (typeof ref === 'function') ref(dom.get(key)); else ref.current = dom.get(key);
  }
  effects.forEach(effect => effect());
  return all;
}
const byRole = (role, all = render()) => all.filter(node => node.props?.role === role);
const tab = label => byRole('tab').find(node => node.props.children === label);
const active = () => byRole('tab').find(node => node.props['aria-selected']).props.children;
const panelFor = label => {
  const selected = tab(label);
  return byRole('tabpanel').find(node => node.props.id === selected.props['aria-controls']);
};
const button = label => render().find(node => node.type === 'button' && text(descendants(node)).some(value => value.trim() === label));
const text = all => all.flatMap(node => Array.isArray(node.props?.children) ? node.props.children : [node.props?.children]).filter(value => typeof value === 'string');

assert.equal(active(), 'Tattoo', 'Tattoo is the initial editing task');
assert.deepEqual(byRole('tab').map(node => node.props.children), ['Tattoo', 'Figure', 'Studio']);
assert.equal(byRole('tabpanel').length, 3, 'All panels stay mounted to retain child state and open disclosures');
assert.equal(byRole('tabpanel').filter(node => !node.props.hidden).length, 1);
for (const node of byRole('tab')) {
  assert.equal(node.props.tabIndex, node.props['aria-selected'] ? 0 : -1);
  assert.equal(byRole('tabpanel').find(panel => panel.props.id === node.props['aria-controls']).props['aria-labelledby'], node.props.id);
}
assert.ok(render().some(node => node.type === 'img' && node.props.src === '/logo.png'));
assert.ok(text(render()).includes('Click the skin to place the example tattoo.'));
assert.equal(button('Show before'), undefined, 'Before/after is offered once a tattoo is placed');
assert.equal(render().filter(node => node.type === 'LightingControls').length, 1, 'One lighting editor');
const studioControls = render().find(node => node.type === 'StudioControls');
assert.equal(studioControls.props.background, 'white');
studioControls.props.onBackgroundChange('warm');
assert.deepEqual(calls.at(-1), ['background', 'warm']);
assert.ok(!text(render()).some(value => /^(Camera|Decal|Export|Performance|Photo mode)$/.test(value)), 'Viewing/export controls do not compete with task controls');

const tattooPanel = panelFor('Tattoo');
dom.get(tattooPanel.props.id).scrollTop = 142;
tattooPanel.props.onScroll({ currentTarget: dom.get(tattooPanel.props.id) });
tab('Figure').props.onClick();
assert.equal(active(), 'Figure');
const figurePanel = panelFor('Figure');
assert.equal(dom.get(figurePanel.props.id).scrollTop, 0);
dom.get(figurePanel.props.id).scrollTop = 673;
figurePanel.props.onScroll({ currentTarget: dom.get(figurePanel.props.id) });
let prevented = 0;
tab('Figure').props.onKeyDown({ key: 'ArrowRight', preventDefault() { prevented++; } });
assert.equal(active(), 'Studio');
assert.equal(focus, tab('Studio').props.id);
const studioPanel = panelFor('Studio');
dom.get(studioPanel.props.id).scrollTop = 288;
studioPanel.props.onScroll({ currentTarget: dom.get(studioPanel.props.id) });
tab('Studio').props.onKeyDown({ key: 'Home', preventDefault() { prevented++; } });
assert.equal(active(), 'Tattoo');
assert.equal(dom.get(panelFor('Tattoo').props.id).scrollTop, 142);
assert.equal(focus, tab('Tattoo').props.id);
tab('Tattoo').props.onKeyDown({ key: 'ArrowLeft', preventDefault() { prevented++; } });
assert.equal(active(), 'Studio', 'Left arrow wraps to the last task');
assert.equal(dom.get(panelFor('Studio').props.id).scrollTop, 288);
tab('Studio').props.onKeyDown({ key: 'ArrowRight', preventDefault() { prevented++; } });
assert.equal(active(), 'Tattoo', 'Right arrow wraps to the first task');
tab('Tattoo').props.onKeyDown({ key: 'End', preventDefault() { prevented++; } });
assert.equal(active(), 'Studio');
tab('Figure').props.onClick();
assert.equal(dom.get(panelFor('Figure').props.id).scrollTop, 673);
assert.equal(prevented, 5);
assert.ok(calls.filter(call => call[0] === 'highlight').every(call => call[1].length === 0), 'Switching tasks clears transient body highlights');

const adjustments = render().filter(node => node.type === 'AdjustmentControl');
const size = adjustments.find(node => node.props.label === 'Size').props;
const rotation = adjustments.find(node => node.props.label === 'Rotation').props;
const opacity = adjustments.find(node => node.props.label === 'Opacity').props;
assert.deepEqual([size.min, size.max, size.step, size.value, size.resetValue, size.unit], [10, 300, 1, 100, 100, '%']);
assert.deepEqual([rotation.min, rotation.max, rotation.resetValue, rotation.unit], [-180, 180, 0, '°']);
assert.deepEqual([opacity.min, opacity.max, opacity.step, opacity.value, opacity.resetValue, opacity.unit], [0, 100, 1, 100, 100, '%']);
size.onChange(175); opacity.onChange(35); rotation.onChange(-35);
assert.deepEqual(calls.slice(-3), [['size', 1.75], ['opacity', .35], ['rotation', -35]]);
assert.equal(button('Reset tattoo adjustments').props.disabled, true);
props.decalScale = 1.3; props.decalColor = '#880e4f';
assert.equal(button('Reset tattoo adjustments').props.disabled, false);
button('Reset tattoo adjustments').props.onClick();
assert.deepEqual(calls.at(-1), ['reset']);
render().find(node => node.props?.['aria-label'] === 'Reset tattoo tint').props.onClick();
assert.deepEqual(calls.at(-1), ['tint', '#ffffff']);
props.hasPlacement = true;
assert.equal(button('Show before').props['aria-pressed'], false);
button('Show before').props.onClick();
assert.equal(button('Show tattoo').props['aria-pressed'], true);
assert.ok(text(render()).includes('Tattoo hidden for a before view. Show tattoo to see your design again.'));
button('Show tattoo').props.onClick();
assert.equal(props.decalVisible, true);

props.uploadedImage = 'data:image/png;base64,new'; props.hasPlacement = false;
assert.ok(text(render()).includes('Click the skin to place your tattoo.'));
const source = props.uploadedImage;
button('Replace image').props.onClick();
assert.deepEqual(calls.at(-1), ['picker']);
assert.equal(props.uploadedImage, source, 'Opening or cancelling a replacement keeps current artwork');
props.disabled = true;
assert.equal(render()[0].props.inert, true, 'Snapshot disables the inspector as one unit');

// The left scene navigation and inspector share a controlled selection.
props.activeTab = 'studio';
props.onTabChange = tab => { props.activeTab = tab; };
let controlled = render();
assert.equal(controlled.find(n => n.props?.role === 'tab' && n.props['aria-selected']).props.children, 'Studio');
controlled.find(n => n.props?.role === 'tab' && n.props.children === 'Figure').props.onClick();
assert.equal(props.activeTab, 'figure');
controlled = render();
assert.equal(controlled.find(n => n.props?.role === 'tab' && n.props['aria-selected']).props.children, 'Figure');
console.log('Controlled sidebar/inspector selection passed.');

for (const name of ['__inspector', '__inspectorRead']) delete globalThis[name];
// Render the complete inspector with its real child controls to catch integration
// problems hidden by the callback test's intentional child-component stubs.
const temporary = path.join(root, `tools/.inspector-integration-${process.pid}.mjs`);
let real;
try {
  await build({ stdin: { contents: `export {default as TopMenuBar} from './src/TopMenuBar';
    export {DEFAULT_BODY_SHAPE} from './src/render/bodyShape';
    export {DEFAULT_BODY_POSE} from './src/render/bodyPose';
    export {DEFAULT_BODY_APPEARANCE} from './src/render/bodyAppearance';
    export {DEFAULT_STUDIO} from './src/render/studioSettings';
    export {resolveRig} from './src/config/lightingPresets';`, resolveDir: root },
    outfile: temporary, bundle: true, format: 'esm', platform: 'node', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' }, logLevel: 'silent' });
  real = await import(pathToFileURL(temporary));
} finally { await fs.rm(temporary, { force: true }); }
for (const variant of [
  { hasPlacement: false, uploadedImage: null, decalVisible: true },
  { hasPlacement: true, uploadedImage: 'data:image/png;base64,example', decalVisible: false, isolateRegion: 'armLeft' },
  { hasPlacement: true, studio: { ...real.DEFAULT_STUDIO, mode: 'sweep' }, bodyAppearance: { ...real.DEFAULT_BODY_APPEARANCE, top: 'tshirt', bottom: 'trousers', hairStyle: 'short' } },
]) {
  const html = renderToStaticMarkup(React.createElement(real.TopMenuBar, {
    ...props, disabled: false, bodyShape: real.DEFAULT_BODY_SHAPE, bodyPose: real.DEFAULT_BODY_POSE,
    bodyAppearance: real.DEFAULT_BODY_APPEARANCE, studio: real.DEFAULT_STUDIO, lights: real.resolveRig('studio'),
    ...variant,
  }));
  assert.equal((html.match(/role="tab"/g) ?? []).length, 3);
  assert.equal((html.match(/role="tabpanel"/g) ?? []).length, 3);
  assert.ok(html.includes('Tattoo size, exact value (%)') && html.includes('Tattoo rotation, exact value (°)'));
  assert.ok(html.includes('Tattoo opacity, exact value (%)'));
  assert.ok(html.includes('Clothes &amp; hair') && html.includes('Adjust limbs') && html.includes('Reset tattoo adjustments'));
  assert.ok(!html.includes('NaN') && !html.includes('Infinity') && !html.includes('>Decal<'));
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'All mounted panels and controls have distinct ids');
  for (const match of html.matchAll(/<button\b([^>]*)>/g)) assert.ok(match[1].includes('type="button"'), 'Editor buttons should never submit forms');
}
console.log('Inspector passed: task tabs, keyboard navigation, mounted panel state, per-tab scroll, default tattoo hints, complete adjustments, percent conversions, visibility, replacement and reset handlers.');
