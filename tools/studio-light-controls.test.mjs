/** Studio controls use real presets/helpers and server-render the actual panel;
 * no browser/WebGL is needed to verify bounds, preservation and accessible UI. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),temporary=path.join(root,`tools/.studio-controls-${process.pid}.mjs`);
await build({stdin:{contents:"export * from './src/render/studioLighting.ts';export * from './src/config/lightingPresets.ts';export {default as LightingControls} from './src/LightingControls.tsx';",resolveDir:root,loader:'ts'},outfile:temporary,bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'},logLevel:'silent'});
const m=await import(pathToFileURL(temporary));await fs.unlink(temporary);
const noop=()=>{};let edits=0;
for(const preset of Object.keys(m.LIGHTING_PRESETS)){
 const lights=m.resolveRig(preset),before=structuredClone(lights);
 const html=renderToStaticMarkup(React.createElement(m.LightingControls,{lights,selectedIndex:null,preset,onPresetChange:noop,onSelectLight:noop,onChange:noop,onReset:noop,showGuides:true,onShowGuidesChange:noop}));
 assert.ok(html.includes('Studio from above. Drag a light, or use arrow keys to move it.'));
 assert.ok(html.includes('role="button"')&&html.includes('tabindex="0"'));
 assert.ok(html.includes('Custom light color')&&html.includes('Light on')&&html.includes('Show lights in the studio'));
 assert.ok(!html.includes('NaN')&&!html.includes('Infinity'));
 assert.deepEqual(lights,before,'Rendering UI must not normalize or rewrite saved rig');
 for(let i=0;i<lights.length;i++){
  const light=lights[i],snapshot=structuredClone(light);assert.ok(m.lightLabel(lights,i).length);assert.ok(m.lightSoftness(light)>=0&&m.lightSoftness(light)<=1);
  for(const [key,[min,max]]of Object.entries(m.STUDIO_LIGHT_LIMITS))for(const value of [min-100,min,(min+max)/2,max,max+100]){
   const next=m.updateLightControl(light,key,value);edits++;assert.equal(next.type,light.type);assert.equal(next.color,light.color);assert.deepEqual(light,snapshot);
   const placement=m.lightPlacement(next),actual=key==='brightness'?next.intensity*100:key==='softness'?next.softness:placement[key];
   // An overhead light has no azimuth until the first horizontal edit.
   assert.ok(actual>=min-1e-9&&actual<=max+1e-9,`${key} escaped bounded edit`);
   if(key==='brightness'||key==='softness')assert.deepEqual(next.position,light.position);
   if(key!=='brightness')assert.equal(next.intensity,light.intensity);
   if(key==='height')assert.deepEqual([next.position[0],next.position[2]],[light.position[0],light.position[2]]);
  }
  for(const key of Object.keys(m.STUDIO_LIGHT_LIMITS))for(const invalid of [NaN,Infinity,-Infinity])assert.equal(m.updateLightControl(light,key,invalid),light);
  for(const [x,z]of[[0,0],[4,6],[-30,60],[100,-90],[-.01,.01]]){
   const moved=m.moveLightOnMap(light,x,z),radius=Math.hypot(moved.position[0],moved.position[2]);assert.ok(radius>=1-1e-9&&radius<=18+1e-9);assert.equal(moved.position[1],light.position[1]);assert.equal(moved.intensity,light.intensity);assert.deepEqual(moved.target,light.target);edits++;
  }
  assert.equal(m.moveLightOnMap(light,NaN,3),light);
  const altered=lights.map((entry,index)=>index===i?{...entry,intensity:.17,position:[2,3,4],enabled:false}:entry),reset=m.resetSelectedLight(altered,i,preset);
  assert.equal(reset[i].intensity,light.intensity);assert.deepEqual(reset[i].position,light.position);for(let j=0;j<lights.length;j++)if(j!==i)assert.equal(reset[j],altered[j]);
  if(reset[i].blenderAreaSize){reset[i].blenderAreaSize[0]=999;assert.notEqual(m.LIGHTING_PRESETS[preset].lights[i].blenderAreaSize?.[0],999,'Reset must not mutate preset area dimensions');}
 }
}
const legacy={type:'directional',position:[32,40,-27],target:[.4,1.2,-.3],intensity:4.7,color:'#faf1e0',blenderAreaSize:[3,1],castShadow:true};const frozen=structuredClone(legacy);
assert.equal(m.lightSoftness(legacy),(2-.25)/3.75);m.lightPlacement(legacy);assert.deepEqual(legacy,frozen);const brightness=m.updateLightControl(legacy,'brightness',120);assert.deepEqual(brightness.position,legacy.position);assert.deepEqual(brightness.target,legacy.target);const aim=m.updateLightControl(legacy,'aimHeight',1.8);assert.deepEqual(aim.target,[.4,1.8,-.3]);assert.equal(aim.intensity,4.7);
assert.equal(m.softboxSize(0),.25);assert.equal(m.softboxSize(1),4);assert.equal(m.softboxSize(NaN),.25+3.75*.45);assert.equal(m.lightSoftness({...legacy,softness:.8}),.8);
assert.equal(m.selectedLightIndex([],null),null);assert.equal(m.selectedLightIndex([{...legacy,type:'ambient'},legacy],99),1);
const ambientHtml=renderToStaticMarkup(React.createElement(m.LightingControls,{lights:[{...legacy,type:'ambient'}],selectedIndex:0,preset:'studio',onPresetChange:noop,onSelectLight:noop,onChange:noop,onReset:noop}));assert.ok(ambientHtml.includes('Room fill'));assert.ok(!ambientHtml.includes('Around figure'));assert.ok(ambientHtml.includes('Brightness'));
console.log(`Studio light controls passed: ${edits} bounded edits across six presets; legacy rig preservation, individual reset, keyboard map semantics and actual panel markup.`);

// Controlled hook scheduling renders the real component and invokes its JSX
// handlers. No duplicated event-handler logic or browser substitute is used.
const {outputFiles:handlerBundle}=await build({
 stdin:{contents:"export {default as LightingControls} from './src/LightingControls.tsx';",resolveDir:root,loader:'ts'},
 bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',
 plugins:[{name:'actual-handler-hooks',setup(builder){
  builder.onResolve({filter:/^react(?:\/jsx-runtime)?$/},args=>({path:args.path,namespace:'test-hooks'}));
  builder.onLoad({filter:/.*/,namespace:'test-hooks'},args=>({contents:args.path==='react'
   ? 'export const useState=v=>[v,()=>{}];export const useId=()=>"studio-handler";export const useRef=value=>globalThis.__lightControlHooks.ref(value);'
   : 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";'}));
  builder.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));
 }}],logLevel:'silent',
});
const handlers=await import(`data:text/javascript;base64,${Buffer.from(handlerBundle[0].text).toString('base64')}`);
const hookRefs=[];let hookCursor=0,rig=m.resolveRig('studio'),selected=null,activePreset='studio',showGuides=true,changes=0,resets=0,selectionEvents=0;
globalThis.__lightControlHooks={ref(value){const index=hookCursor++;return hookRefs[index]??=( {current:value} );}};
const captures=new Set(),mapDom={getBoundingClientRect:()=>({left:30,top:50,width:560,height:500}),setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id)};
function flatten(tree,out=[]){if(Array.isArray(tree))tree.forEach(node=>flatten(node,out));else if(tree&&typeof tree==='object'){out.push(tree);flatten(tree.props?.children,out);}return out;}
function nodes(){hookCursor=0;const tree=handlers.LightingControls({lights:rig,selectedIndex:selected,preset:activePreset,showGuides,onSelectLight:index=>{selected=index;selectionEvents++;},onChange:next=>{rig=next;changes++;},onPresetChange:preset=>{activePreset=preset;rig=m.resolveRig(preset);selected=null;},onReset:()=>{rig=m.resolveRig(activePreset);resets++;},onShowGuidesChange:value=>{showGuides=value;}});const result=flatten(tree);result.find(node=>node.type==='svg').props.ref.current=mapDom;return result;}
function map(){return nodes().find(node=>node.type==='svg');}
function marker(ordinal){return nodes().filter(node=>node.type==='g'&&node.props.role==='button')[ordinal];}
function input(key){const found=nodes().find(node=>typeof node.type==='function'&&node.props.id===`studio-handler-${key}`);assert.ok(found,key);return found;}
function event(extra={}){return{button:0,pointerId:21,preventDefault(){this.prevented=true;},currentTarget:mapDom,...extra};}
let panel=nodes();assert.equal(selected,null);assert.ok(panel.find(node=>node.type==='button'&&node.props.className?.includes('sl-light-chip is-selected')),'null selection must show first positionable light');
// Start dragging Rim. A controlled re-render and selection change must not
// redirect the active pointer to another light.
const untouched=structuredClone(rig);marker(2).props.onPointerDown(event());assert.equal(selected,3);assert.ok(captures.has(21));assert.equal(changes,0,'Selecting a map marker must not move it');
selected=1;map().props.onPointerMove(event({pointerId:22,clientX:398,clientY:300}));assert.deepEqual(rig,untouched,'Wrong pointer changed rig');
map().props.onPointerMove(event({clientX:398,clientY:300}));assert.equal(changes,1);assert.ok(Math.abs(rig[3].position[0]-9)<1e-9);assert.ok(Math.abs(rig[3].position[2])<1e-9);assert.deepEqual(rig[1],untouched[1]);assert.equal(rig[3].position[1],untouched[3].position[1]);
map().props.onPointerUp(event({pointerId:22}));assert.ok(captures.has(21),'Wrong pointer ended active drag');
map().props.onPointerMove(event({clientX:134,clientY:124}));assert.equal(changes,2);map().props.onPointerUp(event());assert.ok(!captures.has(21));const stopped=structuredClone(rig);map().props.onPointerMove(event({clientX:0,clientY:0}));assert.deepEqual(rig,stopped);
marker(0).props.onPointerDown(event({pointerId:31}));map().props.onPointerCancel(event({pointerId:31}));assert.ok(!captures.has(31));const cancelled=structuredClone(rig);map().props.onPointerMove(event({pointerId:31,clientX:99,clientY:99}));assert.deepEqual(rig,cancelled);
marker(0).props.onPointerDown(event({pointerId:41}));map().props.onLostPointerCapture();map().props.onPointerMove(event({pointerId:41,clientX:99,clientY:99}));assert.deepEqual(rig,cancelled);captures.delete(41);
const beforeRight=structuredClone(rig);marker(1).props.onPointerDown(event({button:2}));assert.deepEqual(rig,beforeRight);assert.equal(captures.size,0);
// Real keyboard handlers wrap azimuth and edit only the selected source.
marker(1).props.onKeyDown(event({key:'Enter'}));assert.equal(selected,2);const oldAngle=m.lightPlacement(rig[2]).azimuth;const right=event({key:'ArrowRight',shiftKey:false});marker(1).props.onKeyDown(right);assert.ok(right.prevented);assert.ok(Math.abs(m.lightPlacement(rig[2]).azimuth-(oldAngle+5))<1e-8);
const left=event({key:'ArrowLeft',shiftKey:true});marker(1).props.onKeyDown(left);assert.ok(Math.abs(m.lightPlacement(rig[2]).azimuth-(oldAngle+4))<1e-8);
const radius=m.lightPlacement(rig[2]).distance;marker(1).props.onKeyDown(event({key:'ArrowUp'}));assert.ok(Math.abs(m.lightPlacement(rig[2]).distance-(radius-.5))<1e-8);marker(1).props.onKeyDown(event({key:'ArrowDown'}));assert.ok(Math.abs(m.lightPlacement(rig[2]).distance-radius)<1e-8);
marker(0).props.onClick();assert.equal(selected,1);marker(2).props.onFocus();assert.equal(selected,3);
// Sliders, enable, preset, resets and colors invoke the parent callbacks with
// the same values shown in the actual selected-light panel.
assert.equal(nodes().find(node=>node.type==='select').props.value,'custom','Dragged rig is labeled Custom');
const otherLights=rig.slice(0,3);input('brightness').props.onChange(135);assert.equal(rig[3].intensity,1.35);otherLights.forEach((light,index)=>assert.equal(rig[index],light));
input('softness').props.onChange(80);assert.equal(rig[3].softness,.8);assert.deepEqual(rig[3].blenderAreaSize,[3.25,3.25]);
for(const[key,value]of[['height',4.2],['distance',7.4],['azimuth',70],['aimHeight',1.5]]){input(key).props.onChange(value);assert.ok(Math.abs(m.lightPlacement(rig[3])[key]-value)<1e-8);}
nodes().find(node=>node.type==='input'&&node.props.type==='checkbox').props.onChange({currentTarget:{checked:false}});assert.equal(rig[3].enabled,false);
nodes().find(node=>node.type==='button'&&node.props['aria-label']==='Warm light color').props.onClick();assert.equal(rig[3].color,'#ffd6ad');nodes().find(node=>node.type==='input'&&node.props.type==='color').props.onChange({currentTarget:{value:'#81baff'}});assert.equal(rig[3].color,'#81baff');
const modifiedOthers=rig.slice(0,3);nodes().find(node=>node.type==='button'&&node.props.className==='sl-reset-light').props.onClick();assert.deepEqual(rig[3],m.resolveRig('studio')[3]);modifiedOthers.forEach((light,index)=>assert.equal(rig[index],light));
nodes().find(node=>node.type==='select').props.onChange({currentTarget:{value:'sunset'}});assert.equal(activePreset,'sunset');assert.deepEqual(rig,m.resolveRig('sunset'));assert.equal(selected,null);assert.equal(nodes().find(node=>node.type==='select').props.value,'sunset','Choosing a preset clears Custom');
input('brightness').props.onChange(42);assert.equal(rig[1].intensity,.42,'Null selection fallback edited wrong light');nodes().find(node=>node.type==='button'&&node.props.children==='Reset setup').props.onClick();assert.equal(resets,1);assert.deepEqual(rig,m.resolveRig('sunset'));
nodes().filter(node=>node.type==='input'&&node.props.type==='checkbox').at(-1).props.onChange({currentTarget:{checked:false}});assert.equal(showGuides,false);assert.ok(selectionEvents>0);
delete globalThis.__lightControlHooks;
console.log('Actual LightingControls handlers passed: captured drag/re-render/cancel/wrong pointer, keyboard map, selection fallback, all sliders, enable, colors, preset, individual/full reset and guides.');
