import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
// Exercise production components and the production body-shape API. Only the
// React hooks/JSX nodes and browser events are controlled; no UI or clamping
// behavior is reimplemented. One limit is temporarily asymmetric to catch
// hard-coded -1/+1 bounds and a hard-coded 50% track centre.
const project = fileURLToPath(new URL('..', import.meta.url));
const reactSource = `
 export const useRef=(...args)=>globalThis.__shapeHooks.useRef(...args);
 export const useState=(...args)=>globalThis.__shapeHooks.useState(...args);
 export const useEffect=(...args)=>globalThis.__shapeHooks.useEffect(...args);
 export const useMemo=fn=>fn(); export const useCallback=fn=>fn; export const useId=()=> 'shape-test';`;
async function load(name) {
 const result = await build({stdin:{contents:`export { default } from './src/${name}.tsx'; export { BODY_SHAPE_LIMITS, BODY_SHAPE_PARAMS, DEFAULT_BODY_SHAPE } from './src/render/bodyShape';`,resolveDir:project,loader:'ts'},bundle:true,write:false,format:'esm',platform:'node',jsx:'automatic',loader:{'.css':'empty'},plugins:[{
  name:'controlled-ui',setup(builder){
   builder.onResolve({filter:/^react(?:\/jsx-runtime)?$/},args=>({path:args.path,namespace:'test'}));
   builder.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path==='react'?reactSource:'export const jsx=(type,props)=>({type,props}); export const jsxs=jsx; export const Fragment="fragment";'}));
  }
 }]});
 return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
function children(tree, out=[]) {
 if(Array.isArray(tree)) tree.forEach(child=>children(child,out));
 else if(tree && typeof tree==='object') {out.push(tree);children(tree.props?.children,out)}
 return out;
}
const characterModule = await load('CharacterBuilderSections');
const Character = characterModule.default, limits = characterModule.BODY_SHAPE_LIMITS, defaults = characterModule.DEFAULT_BODY_SHAPE;
limits.chest = {min:-.3,max:.6};
const labelToKey = new Map(characterModule.BODY_SHAPE_PARAMS.map(({key,label})=>[label,key]));
let changed;
const tree = Character({skinToneId:'tone_03',lookId:'studio_softbox',bodyShape:{...defaults,chest:99},onBodyShapeChange:shape=>changed=shape,onHighlightRegions:()=>{},onSkinChange:()=>{},onLookChange:()=>{},onIsolateRegionChange:()=>{},isolateRegion:null});
const elements = children(tree), slider = elements.find(el=>typeof el.type==='function' && labelToKey.get(el.props.label)==='chest');
assert.equal(slider.props.min,-.3);assert.equal(slider.props.max,.6);assert.equal(slider.props.value,.6);
assert.match(slider.props.rangeStyle.background,/33\.3333/,'zero position follows asymmetric bounds');
slider.props.onChange(100);assert.equal(changed.chest,.6);
slider.props.onChange(-100);assert.equal(changed.chest,-.3);
slider.props.onChange(NaN);assert.equal(changed.chest,0);
slider.props.onChange(slider.props.resetValue);assert.equal(changed.chest,0);
for(const input of elements.filter(el=>typeof el.type==='function'&&labelToKey.has(el.props.label))) {
 const key=labelToKey.get(input.props.label);assert.equal(input.props.min,limits[key].min);assert.equal(input.props.max,limits[key].max);
}
assert.ok(elements.some(el=>el.type==='details'&&!el.props.open),'Detailed shape controls start collapsed');
assert.ok(!elements.some(el=>el.props.label==='Focus'||el.props.label==='Lighting'),'Focus and lighting have dedicated surfaces');
const radialModule = await load('RadialShapeMenu'), Radial = radialModule.default;
radialModule.BODY_SHAPE_LIMITS.chest = {min:-.3,max:.6};
function gesture() {
 const hooks=[], events=new Map();let cursor=0, shape={...defaults,chest:.2,waist:.3},closed=0;
 const changes=[];
 globalThis.window={innerWidth:1000,innerHeight:1000,addEventListener:(type,fn)=>events.set(type,fn),removeEventListener:type=>events.delete(type)};
 globalThis.__shapeHooks={
  useRef(value){const i=cursor++;return hooks[i]??=( {current:value})},
  useState(value){const i=cursor++;hooks[i]??={value};return[hooks[i].value,next=>{hooks[i].value=next}]},
  useEffect(fn){const i=cursor++;hooks[i]?.cleanup?.();hooks[i]={cleanup:fn()}},
 };
 const render=()=>{cursor=0;Radial({region:'torso',x:400,y:400,pointerId:7,shape,onChange:(key,value)=>{changes.push([key,value]);shape={...shape,[key]:value}},onClose:()=>closed++})};
 const send=(type,event={})=>{events.get(type)?.(event);render()};
 render();return{send,get shape(){return shape},get closed(){return closed},changes};
}
{
 const app=gesture();app.send('pointermove',{pointerId:8,clientX:400,clientY:-900});assert.equal(app.changes.length,0);
 app.send('pointermove',{pointerId:7,clientX:400,clientY:340});
 app.send('pointermove',{pointerId:7,clientX:400,clientY:-900});assert.equal(app.shape.chest,.6);
 app.send('pointermove',{pointerId:7,clientX:400,clientY:1800});assert.equal(app.shape.chest,-.3);
 app.send('pointermove',{pointerId:7,clientX:452,clientY:370});
 app.send('pointermove',{pointerId:7,clientX:2000,clientY:-500});assert.equal(app.shape.waist,1);
 app.send('keydown',{key:'Escape',preventDefault(){}});assert.equal(app.shape.chest,.2);assert.equal(app.shape.waist,.3);assert.equal(app.closed,1);
 app.send('pointerup',{pointerId:7});assert.equal(app.closed,1,'pointerup after Escape cannot commit again');
}
for(const [event,details] of [['pointercancel',{pointerId:7}],['blur',{}]]){
 const app=gesture();app.send('pointermove',{pointerId:7,clientX:400,clientY:340});app.send('pointermove',{pointerId:7,clientX:400,clientY:-900});
 app.send(event,details);assert.equal(app.shape.chest,.2);assert.equal(app.closed,1);
}
{
 const app=gesture();app.send('pointermove',{pointerId:7,clientX:400,clientY:340});app.send('pointermove',{pointerId:7,clientX:400,clientY:-900});
 app.send('pointerup',{pointerId:7});assert.equal(app.shape.chest,.6);assert.equal(app.closed,1);
 app.send('blur');assert.equal(app.shape.chest,.6,'committed edit remains after later focus loss');
}
console.log('Figure UI checks passed: every slider uses central bounds, asymmetric zero track, input clamping, separate reset value, radial extremes, unrelated pointer rejection, multi-control Escape restoration, pointercancel/blur restoration, release commit.');
delete globalThis.__shapeHooks;
delete globalThis.window;
