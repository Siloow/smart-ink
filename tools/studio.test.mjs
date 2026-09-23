/** Studio controls, migration, real sweep geometry and production frame updates. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
const { outputFiles } = await build({
  stdin: { contents: `export {default as StudioControls} from './src/StudioControls'; export {default as StudioBackdrop} from './src/StudioBackdrop'; export * from './src/render/studioSettings'; export * from './src/render/studioGeometry'; export {migrateScene} from './src/storage/sceneStoreTypes'; export {buildRenderContract,validateContract} from './src/render/buildContract'; export * as THREE from 'three';`, resolveDir: root },
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic',
  plugins: [{ name: 'controlled-hooks', setup(b) {
    b.onResolve({ filter: /^(react(?:\/jsx-runtime)?|@react-three\/fiber)$/ }, a => ({ path: a.path, namespace: 'hooks' }));
    b.onLoad({ filter: /.*/, namespace: 'hooks' }, a => ({ contents: a.path === 'react' ? 'export const useId=()=>"studio-test";export const useState=v=>[v,()=>{}];export const useRef=v=>({current:v});export const useEffect=(...a)=>globalThis.__studioHooks.effect(...a);export const useMemo=(...a)=>globalThis.__studioHooks.memo(...a);' : a.path === '@react-three/fiber' ? 'export const useFrame=fn=>{globalThis.__studioHooks.frame=fn};export const useThree=selector=>selector(globalThis.__studioHooks.environment);' : 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";' }));
    b.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
  } }],
});
const api = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const { DEFAULT_STUDIO: defaults, normalizeStudio, THREE } = api;
const shadowMaterial = api.createStudioShadowMaterial(), shadowShader = { fragmentShader: THREE.ShaderLib.shadow.fragmentShader };
shadowMaterial.onBeforeCompile(shadowShader, {});
assert.equal((shadowShader.fragmentShader.match(/sampleCount \+= 1\.0/g) ?? []).length, 3, 'directional, spot and point shadow samples all count');
assert.doesNotMatch(shadowShader.fragmentShader, /shadow \*=/, 'one blocked softbox sample cannot black out all other samples');
assert.match(shadowShader.fragmentShader, /shadow \/ sampleCount : 1\.0/, 'empty shadow rig stays fully visible');
shadowMaterial.dispose();
assert.deepEqual(normalizeStudio(), defaults);
assert.equal(defaults.mode, 'sweep');
assert.equal(normalizeStudio({ mode: 'plain' }).mode, 'plain', 'preserve explicitly saved plain backgrounds');
assert.deepEqual(api.migrateScene({}).studio, defaults, 'scenes without backdrop settings use the studio default');
assert.deepEqual(normalizeStudio({ mode: 'unsupported', color: 'red', shadow: NaN, showGuides: 'yes' }), defaults);
assert.equal(normalizeStudio({ shadow: 4 }).shadow, 1); assert.equal(normalizeStudio({ shadow: -2 }).shadow, 0);
assert.equal(normalizeStudio({ color: '#AbCdEf' }).color, '#abcdef');
for (const bad of [null, [], false, { mode: 'wall' }, { color: '#fff' }, { shadow: Infinity }, { shadow: -1 }, { showGuides: 1 }, { unknown: 0 }]) assert.ok(api.studioValidationErrors(bad).length);
assert.deepEqual(api.studioValidationErrors({}), []);
assert.equal(api.studioForExport({ ...defaults, mode: 'plain' }, '#fff').color, '#ffffff');
assert.equal(api.studioForExport({ ...defaults, mode: 'sweep' }, '#fff').color, defaults.color);
const choices = { mode: 'sweep', color: '#657b91', shadow: .65, showGuides: true };
assert.deepEqual(api.migrateScene({ studio: choices }).studio, choices);
const contract = api.buildRenderContract({ bodyMeshId: 'body_full', skinToneId: 'tone_03', poseId: 'neutral', lookId: 'studio_softbox', qualityTier: 'preview', studio: choices }, { position: [0,0,8], target: [0,0,0], fov: 45, aspect: 1 }, 'ink.png', { width: 512, height: 512 });
assert.deepEqual(contract.studio, choices); assert.deepEqual(api.validateContract(contract), []);
assert.ok(api.validateContract({ ...contract, studio: { color: 'red' } }).includes('studio.color must be a six-digit hex color'));
function flatten(tree, out = []) { if (Array.isArray(tree)) tree.forEach(t => flatten(t, out)); else if (tree && typeof tree === 'object') { out.push(tree); flatten(tree.props?.children, out); } return out; }
let studio = { ...defaults }, focus = null, background = 'white';
const controls = () => flatten(api.StudioControls({ studio, onStudioChange: s => { studio = s; }, isolateRegion: focus, background, onBackgroundChange:value=>{background=value;} }));
const click = label => { const node = controls().find(n => n.type === 'button' && (n.props.children === label || n.props['aria-label'] === label)); assert.ok(node, label); node.props.onClick(); };
click('Studio sweep'); assert.equal(studio.mode, 'sweep');
for (const paper of api.STUDIO_PAPERS) { click(`${paper.name} backdrop`); assert.equal(studio.color, paper.color); }
controls().find(n => n.type === 'input' && n.props.type === 'color').props.onChange({ target: { value: '#123456' } }); assert.equal(studio.color, '#123456');
controls().find(n => typeof n.type === 'function' && n.props.label === 'Ground shadow').props.onChange(900); assert.equal(studio.shadow, 1);
focus = 'armRight'; assert.ok(controls().some(n => n.type === 'p' && /hides the floor/.test(n.props.children)));
studio.showGuides = true; click('Reset backdrop'); assert.deepEqual(studio, { ...defaults, showGuides: true });
click('Studio sweep'); click('Simple background'); assert.equal(studio.mode, 'plain');
for(const [label,value] of [['White','white'],['Charcoal','dark'],['Gray','gray'],['Sunset','bluepurple'],['Peach','peach']]){click(`${label} background`);assert.equal(background,value);assert.equal(controls().filter(n=>n.type==='button'&&n.props['aria-pressed']&&/background$/.test(n.props['aria-label']??'')).length,1);}
assert.ok(controls().some(n=>n.type==='p'&&String(n.props.children).includes('This gradient is included')));
click('White background');assert.ok(!controls().some(n=>n.type==='p'&&String(n.props.children).includes('This gradient is included')));

let sweepChecks = 0;
for (const height of [.5, 3.7, 4.2, 5.2]) for (const distance of [2, 8, 16, 30]) {
  const geometry = api.createStudioSweepGeometry(height, distance), p = geometry.attributes.position, normal = geometry.attributes.normal, index = geometry.index;
  assert.equal(p.count, 38); assert.ok(p.array.every(Number.isFinite));
  for (let i = 0; i < p.count; i++) { assert.ok(p.getY(i) >= 0); assert.ok(Math.abs(new THREE.Vector3().fromBufferAttribute(normal, i).length() - 1) < 1e-6); }
  for (let i = 0; i < index.count; i += 3) {
    const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const tri = new THREE.Triangle(...ids.map(id => new THREE.Vector3().fromBufferAttribute(p, id)));
    assert.ok(tri.getArea() > 0); assert.ok(tri.getNormal(new THREE.Vector3()).dot(new THREE.Vector3().fromBufferAttribute(normal, ids[0])) > .98, 'paper winding must face the subject');
  }
  geometry.dispose(); sweepChecks++;
}

// Run the actual backdrop component with real Three scene objects. Hooks
// control scheduling only; production geometry, materials and frame callbacks run.
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
const body = new THREE.Mesh(new THREE.BoxGeometry(1, 4.2, .6), new THREE.MeshBasicMaterial());
body.userData.smartInkBody = true; scene.add(body); camera.position.set(6, 3, 8); scene.updateMatrixWorld(true);
const hooks = [], pending = []; let cursor = 0;
const changed = (a,b) => !a || a.length !== b.length || a.some((value,i) => !Object.is(value,b[i]));
globalThis.__studioHooks = { environment: { scene, camera }, frame: null,
  memo(fn,deps) { const i=cursor++; if (changed(hooks[i]?.deps,deps)) hooks[i]={deps,value:fn()}; return hooks[i].value; },
  effect(fn,deps) { const i=cursor++; if (changed(hooks[i]?.deps,deps)) pending.push(() => { hooks[i]?.cleanup?.(); hooks[i]={deps,cleanup:fn()}; }); },
};
function render(settings, region=null, fast=false) { cursor=0; const node=api.StudioBackdrop({studio:settings,isolateRegion:region,performanceMode:fast}); pending.splice(0).forEach(fn=>fn()); if (!node.props.object.parent) scene.add(node.props.object); globalThis.__studioHooks.frame({scene,camera}); return node.props.object; }
const stage = render(choices);
assert.equal(stage.visible,true); assert.ok(Math.abs(stage.position.y + 2.12)<1e-5); assert.equal(stage.userData.editorHelper,undefined,'studio must remain in exports');
assert.equal(stage.children[1].material.opacity,.65); assert.equal(stage.children[1].receiveShadow,true);
assert.equal(scene.background.getHexString(),'657b91'); assert.ok(Math.abs(stage.rotation.y-Math.atan2(6,8))<1e-6);
const oldGeometry=stage.children[0].geometry; let disposed=0; oldGeometry.addEventListener('dispose',()=>disposed++);
body.scale.y=1.3; body.position.y=.2; scene.updateMatrixWorld(true); render(choices);
assert.ok(Math.abs(stage.position.y-(.2-2.1*1.3-.02))<1e-5); assert.equal(disposed,1,'old sweep disposed once after shape changes');
assert.equal(stage.children[0].geometry,stage.children[1].geometry,'shadow overlay shares the sweep');
render(choices,'armLeft'); assert.equal(stage.visible,false); assert.equal(scene.background.getHexString(),'657b91');
render(choices,null,true); assert.equal(stage.visible,true); assert.equal(stage.children[1].visible,false);
camera.position.y=-8; render(choices); assert.equal(stage.visible,false,'bottom views cannot be blocked by floor');
camera.position.y=2; render(choices); assert.equal(stage.visible,true); assert.equal(stage.children[1].visible,true);
render(defaults); assert.equal(stage.visible,true,'default backdrop shows sweep');
render({ ...defaults, mode: 'plain' }); assert.equal(stage.visible,false); assert.equal(scene.background,null,'plain mode restores prior background');
let finalGeometry=0, materials=0; stage.children[0].geometry.addEventListener('dispose',()=>finalGeometry++); stage.children.forEach(mesh=>mesh.material.addEventListener('dispose',()=>materials++));
hooks.forEach(h=>h.cleanup?.()); assert.equal(finalGeometry,1); assert.equal(materials,2);
body.geometry.dispose(); body.material.dispose(); delete globalThis.__studioHooks;
console.log(`Studio passed: controls/colors/reset, persistence/export, validation, ${sweepChecks} sweep geometries, posed floor, camera orbit, Focus/bottom/fast mode, background restoration and cleanup.`);

const gradient = api.studioForExport({ ...defaults, mode: 'plain' }, '#444', ['#444', '#888']);
assert.deepEqual(gradient.gradient, ['#444444', '#888888']);
assert.deepEqual(normalizeStudio(gradient), gradient);
assert.deepEqual(api.studioValidationErrors(gradient), []);
assert.equal(api.studioForExport(defaults, '#444', ['#444', '#888']).gradient, undefined);
assert.ok(api.studioValidationErrors({ gradient: ['red', '#fff'] }).length);
