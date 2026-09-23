import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
const { outputFiles } = await build({ stdin: { contents: "export * from './src/render/tattooSource';export {default as TopMenuBar} from './src/TopMenuBar';", resolveDir: root },
  bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic', plugins: [{ name: 'controlled-panel', setup(b) {
    b.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, a => ({ path: a.path, namespace: 'hooks' }));
    b.onLoad({ filter: /.*/, namespace: 'hooks' }, a => ({ contents: a.path === 'react'
      ? 'export const useId=()=>"tattoo-inspector";export const useRef=v=>globalThis.__tattooHooks.ref(v);export const useState=v=>globalThis.__tattooHooks.state(v);export const useEffect=()=>{};'
      : 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";' }));
    b.onResolve({ filter: /^react-icons\/fa$/ }, () => ({ path: 'icons', namespace: 'stub' }));
    b.onResolve({ filter: /\/utils\/tattooUpload$/ }, () => ({ path: 'upload', namespace: 'stub' }));
    b.onResolve({ filter: /^\.\/(PoseControls|AppearanceControls|StudioControls|CharacterBuilderSections|LightingControls|AdjustmentControl)$/ }, a => ({ path: a.path, namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({ contents: a.path === 'icons'
      ? 'export const FaUpload="upload",FaUndo="undo",FaRegImage="image";'
      : a.path === 'upload' ? 'export const readTattooPng=(...args)=>globalThis.__readTattoo(...args);' : 'export default ()=>null;' }));
  } }] });
const m = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
assert.equal(m.DEFAULT_TATTOO_SOURCE, '/logo.png');
assert.equal(m.resolveTattooSource(null), '/logo.png');
assert.equal(m.resolveTattooSource('data:image/png;base64,upload'), 'data:image/png;base64,upload');
let cursor = 0, uploaded = 'data:image/png;base64,upload', changes = [], reset = 0, deferred, signal;
const slots = [];
globalThis.__tattooHooks = { ref(value) { return slots[cursor++] ??= { current: value }; },
  state(value) { const index = cursor++; slots[index] ??= { value }; return [slots[index].value, next => { slots[index].value = next; }]; } };
globalThis.__readTattoo = (file, currentSignal) => { signal = currentSignal; return new Promise(resolve => { deferred = resolve; }); };
function nodes(node, result = []) { if (Array.isArray(node)) node.forEach(child => nodes(child, result)); else if (node && typeof node === 'object') { result.push(node); nodes(node.props?.children, result); } return result; }
function render() { cursor = 0; return nodes(m.TopMenuBar({ uploadedImage: uploaded, setUploadedImage(value) { uploaded = value; changes.push(value); },
  hasPlacement: true, decalVisible: true, decalColor: '#ffffff', decalScale: 1, decalRotation: 0, decalOpacity: 1, onDecalReset() { reset++; }, lights: [], studio: { showGuides: false },
  CAMERA_PRESETS: Object.fromEntries(['front', 'profile', 'closeup'].map(key => [key, { name: key }])), cameraPreset: 'front' })); }
const example = () => render().find(n => n.type === 'button' && JSON.stringify(n.props.children).includes('Use example tattoo'));
assert.equal(render().find(n => n.type === 'img').props.src, uploaded);
const pending = render().find(n => n.type === 'input' && n.props.type === 'file').props.onChange({ target: { files: [{}], value: 'file' } });
example().props.onClick();
assert.equal(signal.aborted, true, 'Choosing example cancels the pending upload');
assert.equal(uploaded, null);
assert.equal(example().props['aria-pressed'], true);
assert.equal(render().find(n => n.type === 'img').props.src, '/logo.png');
assert.ok(render().some(n => n.props?.children === 'Example tattoo'));
deferred('data:image/png;base64,stale'); await pending;
assert.deepEqual(changes, [null], 'Late upload cannot replace chosen example');
assert.equal(reset, 0, 'Choosing example preserves the existing placement');
delete globalThis.__tattooHooks; delete globalThis.__readTattoo;
console.log('Tattoo source passed: shared default, uploaded source, actual panel example/reset, pending upload cancellation and placement preservation.');
