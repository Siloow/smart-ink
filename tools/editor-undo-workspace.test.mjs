/** Actual Workspace restore/capture and Model placement-replay callbacks. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { build, transform } from 'esbuild';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const source = await fs.readFile(new URL('../src/Workspace.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('Workspace.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const variables = new Map();
function visit(node) { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) variables.set(node.name.text, node); ts.forEachChild(node, visit); }
visit(ast);
const { outputFiles } = await build({ stdin: { contents: "export * from './src/services/editorHistory'; export * as THREE from 'three';", resolveDir: root }, bundle: true, write: false, platform: 'node', format: 'esm' });
const { createEditorHistory, THREE } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
async function factory(code, names) {
  const { code: js } = await transform(`(function(${names.join(',')}) {return ${code};})`, { loader: 'tsx' });
  const make = (0, eval)(js); return scope => make(...names.map(name => { assert.ok(Object.hasOwn(scope, name), name); return scope[name]; }));
}
const anchor = faceIndex => ({ bodyMeshId: 'body_full', faceIndex, barycentric: [.2,.3,.5] });
const initial = {
  uploadedImage: null, decalRotation: 0, decalScale: 1, decalColor: '#ffffff', decalOpacity: 1,
  decalVisible: false, surfacePlacement: null, decalPosition: null, decalNormal: null,
  bodyFit: null, bodyMeshId: 'body_full', skinToneId: 'tone_03', bodyShape: { arms: 0 }, bodyPose: { leftElbow: 0 },
  poseId: 'neutral', bodyAppearance: { top: 'none', hairStyle: 'none' }, studio: { mode: 'plain', color: '#ffffff' },
  background: 'white', lightingPreset: 'studio', lights: [{ type: 'ambient', intensity: .2 }], lookId: 'studio_softbox',
};
const fields = Object.keys(initial);
const capture = await factory(variables.get('editValue').initializer.getText(ast), ['useMemo', ...fields]);
const transient = ['ShapeMenu', 'HoverRegion', 'PanelRegions', 'SelectedLight', 'PlacementStatus'];
const setterNames = fields.map(key => `set${key[0].toUpperCase()}${key.slice(1)}`);
const restore = await factory(variables.get('restoreEdits').initializer.getText(ast), ['useCallback', ...setterNames, ...transient.map(name => `set${name}`)]);
let current = structuredClone(initial), camera = { position: [1,2,3] }, focus = 'armLeft', calls = [];
const setterScope = { useCallback: fn => fn };
fields.forEach((name, i) => setterScope[setterNames[i]] = value => { current[name] = value; calls.push(name); });
transient.forEach(name => setterScope[`set${name}`] = () => {});
const apply = restore(setterScope);
const captured = () => capture({ ...current, useMemo: fn => fn() });
assert.deepEqual(captured(), initial);
const history = createEditorHistory(captured());
function change(patch) { current = { ...current, ...patch }; history.observe(captured()); }
function undo() { assert.ok(history.undo()); apply(history.getState().value); history.observe(captured()); }
function redo() { assert.ok(history.redo()); apply(history.getState().value); history.observe(captured()); }
// One placement includes its visibility; Undo really returns to empty skin.
change({ surfacePlacement: anchor(21), decalVisible: true }); undo();
assert.equal(current.surfacePlacement, null); assert.equal(current.decalVisible, false); redo();
assert.equal(current.surfacePlacement.faceIndex, 21); assert.equal(current.decalVisible, true);
history.beginGesture();
for (let i = 22; i <= 40; i++) change({ surfacePlacement: anchor(i) });
history.endGesture(); undo(); assert.equal(current.surfacePlacement.faceIndex, 21); redo(); assert.equal(current.surfacePlacement.faceIndex, 40);
// Body switch invalidates its placement atomically, and undo restores both.
change({ bodyMeshId: 'body_full_female', surfacePlacement: null, decalVisible: false }); undo();
assert.equal(current.bodyMeshId, 'body_full'); assert.equal(current.surfacePlacement.faceIndex, 40);
change({ bodyFit: { version: 1, measurements: { height: 175 } } }); undo();
assert.equal(current.bodyFit, null); redo(); assert.equal(current.bodyFit.measurements.height, 175); undo();
change({ bodyShape: { arms: .4 }, bodyPose: { leftElbow: 40 }, poseId: 'custom', bodyAppearance: { top: 'tshirt', hairStyle: 'short' } }); undo();
assert.deepEqual(current.bodyShape, { arms: 0 }); assert.equal(current.bodyAppearance.top, 'none');
change({ decalOpacity: 0, decalRotation: -180, decalScale: .1, uploadedImage: 'data:image/png;base64,example' }); undo();
assert.equal(current.uploadedImage, null); assert.equal(current.decalOpacity, 1);
change({ studio: { mode: 'sweep', color: '#ffaa00' }, lights: [{ type: 'ambient', intensity: 0 }], background: 'dark', lightingPreset: 'dramatic' }); undo();
assert.equal(current.background, 'white'); assert.equal(current.studio.mode, 'plain'); assert.equal(current.lights[0].intensity, .2);
assert.deepEqual(camera, { position: [1,2,3] }); assert.equal(focus, 'armLeft');
assert.deepEqual([...new Set(calls)].sort(), fields.sort(), 'Every editable field is restored, including zero/false/null');
assert.ok(!Object.hasOwn(captured(), 'cameraState') && !Object.hasOwn(captured(), 'isolateRegion'), 'Viewing must not create history entries');

const modelSource = await fs.readFile(new URL('../src/ModelWithUVTattoo.tsx', import.meta.url), 'utf8');
const modelAst = ts.createSourceFile('Model.tsx', modelSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function find(node) {
  if (ts.isCallExpression(node) && node.expression.getText(modelAst) === 'useEffect' && node.arguments[0]?.getText(modelAst).includes('const desired = initialPlacement')) effect = node.arguments[0];
  ts.forEachChild(node, find);
}
find(modelAst); assert.ok(effect, 'Model must replay changed parent placements');
const names = ['cloneGroup','initialPlacement','anchorRef','chartRef','applyAnchor','hasPlacedRef','setHasPlaced','bodyMeshRef','shaderMaterial','setChartVersion','onPlacementStatus'];
const replay = await factory(effect.getText(modelAst), names);
const geometry = new THREE.BufferGeometry(); geometry.setAttribute('aTattooMask', new THREE.Float32BufferAttribute([1,1,1], 1));
let chartBuilds = 0, version = 0, status = '', hasPlaced = true;
const env = { cloneGroup: {}, initialPlacement: anchor(40), anchorRef: { current: null }, chartRef: { current: null }, hasPlacedRef: { current: true },
  bodyMeshRef: { current: { geometry } }, shaderMaterial: { uniforms: { tattooVisible: { value: 1 } } },
  setHasPlaced: value => hasPlaced = value, setChartVersion: fn => version = fn(version), onPlacementStatus: value => status = value,
  applyAnchor: (value, notify) => { assert.equal(notify, false, 'Replay must not notify/force visibility'); if (value.bodyMeshId !== 'body_full') return false; chartBuilds++; env.anchorRef.current = value; env.chartRef.current = {}; env.hasPlacedRef.current = hasPlaced = true; return true; },
};
replay(env)(); assert.equal(chartBuilds, 1); assert.equal(env.anchorRef.current.faceIndex, 40);
replay(env)(); assert.equal(chartBuilds, 1, 'A parent echo of an already applied drag cannot rebuild twice');
env.initialPlacement = anchor(21); replay(env)(); assert.equal(chartBuilds, 2); assert.equal(env.anchorRef.current.faceIndex, 21);
env.initialPlacement = null; replay(env)();
assert.equal(hasPlaced, false); assert.equal(env.hasPlacedRef.current, false); assert.equal(env.chartRef.current, null); assert.equal(env.anchorRef.current, null);
assert.ok(geometry.attributes.aTattooMask.array.every(value => value === 0)); assert.equal(env.shaderMaterial.uniforms.tattooVisible.value, 0); assert.ok(version > 0);
env.initialPlacement = { ...anchor(1), bodyMeshId: 'wrong-body' }; replay(env)(); assert.equal(env.anchorRef.current, null); assert.match(status, /restore/);
const count = chartBuilds; env.cloneGroup = null; env.initialPlacement = anchor(12); replay(env)(); assert.equal(chartBuilds, count, 'Wait for the mesh');
geometry.dispose();
console.log('Workspace Undo passed: actual snapshot/restore, placement/visibility, drag coalescing, figure switch, shape/pose/outfit, artwork/zero opacity, studio/lights, view exclusion and Model clear/replay without duplicate chart work.');
