/** Actual shared field handlers: drafts, clamping and reset must remain predictable. */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const {outputFiles}=await build({stdin:{contents:"export {default} from './src/AdjustmentControl';",resolveDir:root,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'real-fields',setup(b){b.onResolve({filter:/^react(?:\/jsx-runtime)?$/},a=>({path:a.path,namespace:'hooks'}));b.onLoad({filter:/.*/,namespace:'hooks'},a=>({contents:a.path==='react'?'export const useId=()=>"field";export const useState=v=>globalThis.__fields.state(v);export const useRef=v=>globalThis.__fields.ref(v);':'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;'}));}}]});
const {default:Control}=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const hooks=[];let cursor=0,changes=[];
globalThis.__fields={state(v){const n=cursor++;hooks[n]??={value:v};return[hooks[n].value,next=>hooks[n].value=next];},ref(v){const n=cursor++;return hooks[n]??={current:v};}};
let props={label:'Rotation',value:12,min:-180,max:180,step:1,unit:'°',resetValue:0,onChange:v=>{props.value=v;changes.push(v);}};
function flatten(tree,out=[]){if(Array.isArray(tree))tree.forEach(n=>flatten(n,out));else if(tree&&typeof tree==='object'){out.push(tree);flatten(tree.props?.children,out);}return out;}
function nodes(){cursor=0;return flatten(Control(props));}
const field=()=>nodes().find(n=>n.type==='input'&&n.props.type==='text');
const range=()=>nodes().find(n=>n.type==='input'&&n.props.type==='range');
const reset=()=>nodes().find(n=>n.type==='button');
function edit(value){field().props.onFocus();field().props.onChange({currentTarget:{value}});}
function blur(value=field().props.value){field().props.onBlur({currentTarget:{value}});}
function key(key,value=field().props.value,shiftKey=false){const event={key,shiftKey,currentTarget:{value,blur(){blur(value);}},preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};field().props.onKeyDown(event);return event;}
assert.equal(field().props.value,'12');assert.equal(reset().props['aria-label'],'Reset rotation');
field().props.onFocus();assert.equal(changes.length,0,'Clicking a numeric value must not reset it');
for(const partial of ['','-','-1.','-.']){field().props.onChange({currentTarget:{value:partial}});assert.equal(field().props.value,partial);assert.equal(changes.length,0,'Partial numeric input must not alter the scene');}
field().props.onChange({currentTarget:{value:'-12.5'}});const enter=key('Enter');assert.equal(props.value,-12.5);assert.equal(changes.length,1,'Enter + blur commits once');assert.ok(enter.prevented&&enter.stopped);assert.equal(field().props.value,'-12.5');
edit('34');const escape=key('Escape');assert.equal(props.value,-12.5);assert.equal(field().props.value,'-12.5');assert.ok(escape.stopped,'Escape cannot close the enclosing editor or Snapshot');
for(const invalid of ['',' ','-','NaN','Infinity','not a number']){edit(invalid);blur();assert.equal(props.value,-12.5);assert.equal(field().props.value,'-12.5');}
edit('999');blur();assert.equal(props.value,180);edit('-999');blur();assert.equal(props.value,-180);
edit('0');key('ArrowUp');assert.equal(props.value,1);key('ArrowDown','1',true);assert.equal(props.value,-9);
const left=key('ArrowLeft','-9');assert.ok(!left.prevented,'Left/right preserve text caret navigation');
range().props.onChange({currentTarget:{value:'42'}});assert.equal(props.value,42);
range().props.onChange({currentTarget:{value:'NaN'}});assert.equal(props.value,42);
range().props.onChange({currentTarget:{value:'999'}});assert.equal(props.value,180);
reset().props.onClick();assert.equal(props.value,0);assert.equal(reset().props.disabled,true);
props.value=31;assert.equal(field().props.value,'31','Undo, presets and external edits update an unfocused field');
props={...props,min:10,max:300,unit:'%',resetValue:100,value:130};reset().props.onClick();assert.equal(props.value,100);assert.equal(range().props['aria-valuetext'],'100%');
props={...props,min:-.3,max:.6,step:.02,unit:'',resetValue:0,value:.2};edit('.');assert.equal(props.value,.2);field().props.onChange({currentTarget:{value:'.38'}});blur();assert.equal(props.value,.38);edit('0.38');key('ArrowUp');assert.equal(props.value,.4,'Fractional arrows avoid floating point artifacts');
props={...props,disabled:true};assert.equal(field().props.disabled,true);assert.equal(range().props.disabled,true);assert.equal(reset().props.disabled,true);
delete globalThis.__fields;
console.log('Shared adjustments passed: partial drafts, click-to-edit, single commit, Escape cancellation, invalid/empty rollback, bounded numbers/ranges, fractional arrows, units, external undo updates and independent resets.');
