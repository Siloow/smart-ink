/** Real appearance controls, saved scenes, export contracts and ray ownership. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
const { outputFiles } = await build({
  stdin: { contents: `export {default as AppearanceControls} from './src/AppearanceControls'; export * from './src/render/bodyAppearance'; export * from './src/render/previewAppearance'; export {migrateScene} from './src/storage/sceneStoreTypes'; export {buildRenderContract,validateContract} from './src/render/buildContract'; export * as THREE from 'three';`, resolveDir: root },
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'controlled-react', setup(b) {
    b.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, a => ({ path: a.path, namespace: 'hooks' }));
    b.onLoad({ filter: /.*/, namespace: 'hooks' }, a => ({ contents: a.path === 'react' ? 'export const useId=()=>"appearance-test";' : 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;' }));
  } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const { DEFAULT_BODY_APPEARANCE: defaults, normalizeAppearance, appearanceValidationErrors, THREE } = api;
for (const value of [undefined, null, {}, { top: 'suit', bottom: 'jeans', hairStyle: 'long', hairTone: 'pink', topColor: '<bad>', bottomColor: 'red' }]) assert.deepEqual(normalizeAppearance(value), defaults);
const edited = normalizeAppearance({ top: 'tshirt', bottom: 'trousers', topColor: '#ABCDEF', hairStyle: 'short', hairTone: 'auburn' });
assert.equal(edited.topColor, '#abcdef');
assert.deepEqual(api.migrateScene({}).bodyAppearance, defaults, 'old scenes retain their bare preview');
assert.deepEqual(api.migrateScene({ bodyAppearance: edited }).bodyAppearance, edited);
assert.notEqual(api.migrateScene({ bodyAppearance: edited }).bodyAppearance, edited);
const contract = api.buildRenderContract({ bodyMeshId: 'body_full', skinToneId: 'tone_03', poseId: 'neutral', lookId: 'studio_softbox', qualityTier: 'preview', bodyAppearance: edited }, { position: [0,0,8], target: [0,0,0], fov: 45, aspect: 1 }, 'ink.png', { width: 512, height: 512 });
assert.deepEqual(contract.bodyAppearance, edited); assert.deepEqual(api.validateContract(contract), []);
for (const bad of [null, [], false, { shoes: 'boots' }, { hairStyle: 'long' }, { topColor: '#fff' }, { hairTone: null }]) {
  assert.ok(appearanceValidationErrors(bad).length); assert.ok(api.validateContract({ ...contract, bodyAppearance: bad }).length);
}
function flatten(tree, out = []) { if (Array.isArray(tree)) tree.forEach(t => flatten(t, out)); else if (tree && typeof tree === 'object') { out.push(tree); flatten(tree.props?.children, out); } return out; }
let appearance = { ...defaults }, focus = null;
const render = () => flatten(api.AppearanceControls({ bodyAppearance: appearance, onAppearanceChange: a => { appearance = a; }, isolateRegion: focus }));
const click = label => { const node = render().find(n => n.type === 'button' && (n.props.children === label || n.props['aria-label'] === label)); assert.ok(node, label); node.props.onClick(); };
const change = (key, value) => { const node = render().find(n => n.type === 'select' && n.props.id === `appearance-test-${key}`); assert.ok(node); node.props.onChange({ target: { value } }); };
assert.equal(render().filter(n => n.props.className === 'appearance-swatch').length, 0);
click('Casual'); assert.equal(appearance.top, 'tshirt'); assert.equal(appearance.bottom, 'trousers');
assert.equal(render().filter(n => n.props.className === 'appearance-swatch').length, 10);
click('Top: Sage'); click('Bottoms: Burgundy'); assert.equal(appearance.topColor, '#6c7764'); assert.equal(appearance.bottomColor, '#763d45');
change('hair', 'short'); click('Hair: Blond'); assert.equal(appearance.hairStyle, 'short'); assert.equal(appearance.hairTone, 'blond');
assert.equal(render().filter(n => n.props.className === 'appearance-swatch' && n.props['aria-pressed'] === true).length, 3);
click('No clothes'); assert.equal(appearance.top, 'none'); assert.equal(appearance.bottom, 'none'); assert.equal(appearance.hairStyle, 'short', 'outfit changes preserve hair');
click('T-shirt & shorts'); assert.equal(appearance.bottom, 'shorts'); assert.equal(appearance.topColor, '#6c7764', 'outfit changes preserve colors');
for (const option of ['none', 'shorts', 'trousers']) { change('bottom', option); assert.equal(appearance.bottom, option); }
for (const option of ['none', 'tshirt']) { change('top', option); assert.equal(appearance.top, option); }
for (const option of ['none', 'buzz', 'short']) { change('hair', option); assert.equal(appearance.hairStyle, option); }
focus = 'armRight'; assert.ok(render().some(n => n.type === 'p' && /Clothes are hidden in Focus/.test(n.props.children)));
click('Reset appearance'); assert.deepEqual(appearance, defaults);

// An accessory hit can never be mistaken for a body triangle. Invisible
// ancestors are skipped even though Three's raycaster may intersect children.
const scene = new THREE.Scene(), body = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()); scene.add(body);
assert.equal(api.appearanceHit(body), null);
for (const kind of ['clothing', 'hair']) {
  const accessory = new THREE.Group(); accessory.userData.previewAppearance = kind;
  const nested = new THREE.Group(), geometry = new THREE.BoxGeometry(), material = new THREE.MeshStandardMaterial();
  nested.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material)); accessory.add(nested); body.add(accessory);
  assert.equal(api.appearanceHit(nested.children[0]), kind);
  accessory.visible = false; assert.equal(api.appearanceHit(nested.children[0]), 'hidden'); accessory.visible = true;
  body.visible = false; assert.equal(api.appearanceHit(nested.children[0]), 'hidden'); body.visible = true;
  let geometries = 0, materials = 0;
  geometry.addEventListener('dispose', () => geometries++); material.addEventListener('dispose', () => materials++);
  api.disposeAppearance(accessory); assert.equal(accessory.parent, null); assert.equal(geometries, 1); assert.equal(materials, 1);
}
assert.equal(body.children.length, 0);
console.log('Appearance passed: actual controls, presets/colors/reset, legacy scenes, saved/exported choices, validation, accessory ray ownership and disposal.');
