/** Production camera-control markup and handlers; no copied normalization math. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = "export {default as Camera} from './src/SnapshotCameraControls.tsx'; export {TATTOO_CAMERA_LIMITS as limits} from './src/render/tattooCamera.ts';";
const temporary = path.join(root, `tools/.snapshot-camera-controls-${process.pid}.mjs`);
await build({ stdin: { contents: source, resolveDir: root, loader: 'ts' }, outfile: temporary, bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', loader: {'.css':'empty'}, external: ['react', 'react/jsx-runtime'], logLevel: 'silent' });
const real = await import(pathToFileURL(temporary)); await fs.unlink(temporary);
const noop = () => {};
for (const hasTattoo of [true, false]) {
  const html = renderToStaticMarkup(React.createElement(real.Camera, { adjustment: { azimuth: 0, elevation: 0, zoom: 1 }, onChange: noop, onReset: noop, hasTattoo }));
  assert.ok(html.includes(hasTattoo ? 'Around tattoo' : 'Around figure'));
  assert.equal((html.match(/type="range"/g) ?? []).length, 3);
  assert.equal((html.match(/type="text"/g) ?? []).length, 3);
  assert.ok(html.includes('aria-valuetext="100%"') && html.includes('Reset view'));
  assert.ok(html.includes('Hold Shift for larger steps.'));
}
const invalid = renderToStaticMarkup(React.createElement(real.Camera, { adjustment: { azimuth: NaN, elevation: Infinity, zoom: -999 }, onChange: noop, onReset: noop, hasTattoo: true }));
assert.ok(!invalid.includes('NaN') && !invalid.includes('Infinity') && invalid.includes('aria-valuetext="65%"'));

const { outputFiles } = await build({ stdin: { contents: source, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', loader: {'.css':'empty'}, plugins: [{ name: 'actual-camera-handlers', setup(builder) {
  builder.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'controlled' }));
  builder.onLoad({ filter: /.*/, namespace: 'controlled' }, args => ({ contents: args.path === 'react' ? 'export const useId=()=>"camera-test";export const useState=v=>[v,()=>{}];export const useRef=v=>({current:v});' : 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";' }));
} }], logLevel: 'silent' });
const api = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
let changes = 0, resets = 0;
const props = { adjustment: { azimuth: 0, elevation: 0, zoom: 1 }, hasTattoo: true, onChange(value) { props.adjustment = value; changes++; }, onReset() { resets++; } };
function flatten(tree, output = []) { if (Array.isArray(tree)) tree.forEach(node => flatten(node, output)); else if (tree && typeof tree === 'object') { output.push(tree); flatten(tree.props?.children, output); } return output; }
function nodes() { return flatten(api.Camera(props)); }
function input(key) { const input = nodes().find(node => typeof node.type === 'function' && node.props.id === `camera-test-${key}-range`); assert.ok(input); return input; }
function text(tree) { return typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(text).join('') : tree?.props ? text(tree.props.children) : ''; }
function button(label) { const button = nodes().find(node => node.type === 'button' && text(node).replace(/[−+]/g, '') === label); assert.ok(button, label); return button; }
input('azimuth').props.onChange(12);
assert.deepEqual(props.adjustment, { azimuth: 12, elevation: 0, zoom: 1 });
button('Right').props.onClick({ shiftKey: false }); assert.equal(props.adjustment.azimuth, 13);
button('Left').props.onClick({ shiftKey: true }); assert.equal(props.adjustment.azimuth, 8);
button('Higher').props.onClick({ shiftKey: false }); assert.equal(props.adjustment.elevation, 1);
button('Lower').props.onClick({ shiftKey: true }); assert.equal(props.adjustment.elevation, -4);
input('azimuth').props.onChange(-12.3); assert.equal(props.adjustment.azimuth, -12.3);
input('zoom').props.onChange(137); assert.equal(props.adjustment.zoom, 1.37);
button('Closer').props.onClick({ shiftKey: true }); assert.ok(Math.abs(props.adjustment.zoom - 1.47) < 1e-12);
input('zoom').props.onChange(0); assert.equal(props.adjustment.zoom, api.limits.zoom.min); assert.equal(button('Wider').props.disabled, true);
input('azimuth').props.onChange(999); assert.equal(props.adjustment.azimuth, api.limits.azimuth.max); assert.equal(button('Right').props.disabled, true);
input('elevation').props.onChange(1000); assert.equal(props.adjustment.elevation, api.limits.elevation.max); assert.equal(button('Higher').props.disabled, true);
const beforeInvalid = { ...props.adjustment }; input('elevation').props.onChange(NaN); assert.deepEqual(props.adjustment, beforeInvalid);
input('zoom').props.onChange(input('zoom').props.resetValue);assert.equal(props.adjustment.zoom,1,'Shared field reset uses percent units');
button('Reset view').props.onClick(); assert.equal(resets, 1);
console.log('SnapshotCameraControls: real markup and handlers pass precise numeric edits, bounded sliders, ±1°/Shift nudges, percent zoom, shared precise numeric controls, invalid input, reset, and tattoo/body fallback labels.');
