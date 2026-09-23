/** Actual SnapshotOverlay markup, handlers and keyboard/focus lifecycle. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const source="export {default as SnapshotOverlay} from './src/SnapshotOverlay.tsx';";
const temporary=path.join(root,`tools/.snapshot-overlay-${process.pid}.mjs`);
await build({stdin:{contents:source,resolveDir:root,loader:'ts'},outfile:temporary,bundle:true,platform:'node',format:'esm',jsx:'automatic',external:['react','react/jsx-runtime'],loader:{'.css':'empty'},logLevel:'silent'});
const real=await import(pathToFileURL(temporary));await fs.unlink(temporary);
const noop=()=>{},base={mode:'result',status:'idle',imageUrl:null,message:'',elapsed:0,quality:'quick',onQualityChange:noop,onRender:noop,onCancel:noop,onClose:noop,onDownload:noop,onAdjust:noop};
let states=0;
for(const status of['idle','uploading','rendering','done','error','cancelled'])for(const imageUrl of[null,'blob:previous-snapshot'])for(const quality of['quick','detailed']){
 const html=renderToStaticMarkup(React.createElement(real.SnapshotOverlay,{...base,status,imageUrl,quality,elapsed:75,message:status==='error'?'The render service is unavailable.':'',warning:'This view uses the selected studio setup.'}));
 assert.ok(html.includes('role="dialog"')&&html.includes('aria-modal="true"'));
 assert.ok(html.includes('Back to editing')&&html.includes('Snapshot'));
 assert.ok(html.includes('1:15')&&!html.includes('NaN'));
 assert.equal(html.includes('src="blob:previous-snapshot"'),Boolean(imageUrl),'Previous image must survive every status');
 assert.ok(html.includes('This view uses the selected studio setup.'));
 if(status==='uploading'||status==='rendering'){assert.ok(html.includes('Cancel render'));assert.ok(html.includes('<fieldset class="snapshot-quality" disabled=""'));if(imageUrl)assert.ok(html.includes('Updating snapshot'));}
 else{assert.ok(!html.includes('Cancel render'));if(status==='error'||status==='cancelled')assert.ok(html.includes('Try again'));}
 if(status==='error')assert.ok(html.includes('role="alert"')&&html.includes('The render service is unavailable.'));
 states++;
}
const invalidTime=renderToStaticMarkup(React.createElement(real.SnapshotOverlay,{...base,status:'rendering',elapsed:NaN}));assert.ok(invalidTime.includes('0:00'));assert.ok(!invalidTime.includes('NaN'));
const resizedView=renderToStaticMarkup(React.createElement(real.SnapshotOverlay,{...base,status:'done',imageUrl:'blob:previous-snapshot',comparisonAvailable:false}));assert.ok(resizedView.includes('Compare unavailable')&&resizedView.includes('Resize back to the captured view to compare.'));assert.ok(/aria-describedby="[^"]+-comparison-hint" disabled=""/.test(resizedView));
const changedView=renderToStaticMarkup(React.createElement(real.SnapshotOverlay,{...base,status:'error',imageUrl:'blob:previous-snapshot',comparisonAvailable:false,comparisonUnavailableReason:'Render the adjusted shot before comparing it with the live view.'}));assert.ok(changedView.includes('Render the adjusted shot before comparing it with the live view.')&&!changedView.includes('Resize back'));assert.ok(/aria-describedby="[^"]+-comparison-hint" disabled=""/.test(changedView));
for(const status of['idle','done','error','cancelled'])for(const imageUrl of[null,'blob:previous-snapshot']){
 const html=renderToStaticMarkup(React.createElement(real.SnapshotOverlay,{...base,mode:'compose',status,imageUrl,elapsed:85,framingHint:'Centered on your tattoo.',cameraControls:React.createElement('input',{'aria-label':'Camera slot'}),lightingControls:React.createElement('svg',{'aria-label':'Lighting slot'})}));
 assert.ok(html.includes('snapshot-overlay--compose')&&html.includes('snapshot-overlay--live')&&html.includes('Compose · live view'));
 assert.ok(html.includes('Camera slot')&&html.includes('Lighting slot')&&html.includes('Centered on your tattoo.'));
 assert.ok(html.includes('Render snapshot')&&!html.includes('Compare with live')&&!html.includes('1:25')&&!html.includes('snapshot-empty'));
 if(imageUrl)assert.ok(html.includes('snapshot-image--hidden')&&html.includes('Download previous'));
 states++;
}
const busyCompose=renderToStaticMarkup(React.createElement(real.SnapshotOverlay,{...base,mode:'compose',status:'rendering',cameraControls:React.createElement('input',{'aria-label':'Camera slot'})}));assert.ok(!busyCompose.includes('snapshot-overlay--compose')&&!busyCompose.includes('Camera slot')&&busyCompose.includes('Cancel render'));

const {outputFiles}=await build({stdin:{contents:source,resolveDir:root,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',plugins:[{name:'snapshot-controlled-hooks',setup(builder){
 builder.onResolve({filter:/^react(?:\/jsx-runtime)?$/},args=>({path:args.path,namespace:'hooks'}));
 builder.onLoad({filter:/.*/,namespace:'hooks'},args=>({contents:args.path==='react'?`export const useId=()=>"snapshot-test";export const useRef=value=>globalThis.__snapshotHooks.ref(value);export const useState=value=>globalThis.__snapshotHooks.state(value);export const useEffect=(fn,deps)=>globalThis.__snapshotHooks.effect(fn,deps);`:'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";'}));
 builder.onLoad({filter:/\.css$/},()=>({contents:'',loader:'js'}));
}}],logLevel:'silent'});
const api=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const slots=[],effects=[];let cursor=0,renderCalls=0,cancelCalls=0,closeCalls=0,downloadCalls=0,qualityChanges=0,adjustCalls=0;
const originalDocument=globalThis.document;
function element({disabled=false,hidden=false,inert=false}={}){return{tabIndex:0,isConnected:true,matches:()=>disabled,closest:()=>inert?{}:null,getClientRects:()=>hidden?[]:[{}],focus(){globalThis.document.activeElement=this;}};}
const trigger=element(),close=element(),last=element(),disabled=element({disabled:true}),hidden=element({hidden:true}),inert=element({inert:true});
let candidates=[close,disabled,hidden,inert,last];
const container={tabIndex:-1,querySelectorAll:()=>candidates,getBoundingClientRect:()=>({width:840,height:700}),focus(){globalThis.document.activeElement=this;}};
globalThis.document={activeElement:trigger};
globalThis.__snapshotHooks={
 ref(value){const index=cursor++;return slots[index]??={current:value};},
 state(value){const index=cursor++;if(!(index in slots))slots[index]={value:typeof value==='function'?value():value};return[slots[index].value,next=>{slots[index].value=typeof next==='function'?next(slots[index].value):next;}];},
 effect(fn,deps){const index=cursor++,previous=slots[index];if(!previous||deps.some((value,i)=>!Object.is(value,previous.deps[i]))){slots[index]={deps,cleanup:previous?.cleanup};effects.push(()=>{slots[index].cleanup?.();slots[index].cleanup=fn();});}},
};
let props={...base,onQualityChange:value=>{props.quality=value;qualityChanges++;},onRender:()=>renderCalls++,onCancel:()=>cancelCalls++,onClose:()=>closeCalls++,onDownload:()=>downloadCalls++,onAdjust:()=>{props.mode='compose';adjustCalls++;}};
function flatten(tree,out=[]){if(Array.isArray(tree))tree.forEach(node=>flatten(node,out));else if(tree&&typeof tree==='object'){out.push(tree);flatten(tree.props?.children,out);}return out;}
function nodes(){cursor=0;const result=flatten(api.SnapshotOverlay(props));result.find(node=>node.type==='section').props.ref.current=container;result.find(node=>node.type==='button'&&node.props.className?.includes('snapshot-button--back')).props.ref.current=close;effects.splice(0).forEach(fn=>fn());return result;}
function button(label){const node=nodes().find(node=>node.type==='button'&&node.props.children===label);assert.ok(node,label);return node;}
function rootNode(){return nodes().find(node=>node.type==='section');}
function key(key,shiftKey=false){return{key,shiftKey,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};}
nodes();assert.equal(document.activeElement,close,'Opening Snapshot must focus its exit');
assert.equal(button('Download').props.disabled,true);assert.equal(button('Compare with live').props.disabled,true);
button('Render snapshot').props.onClick();assert.equal(renderCalls,1);
button('Detailed').props.onClick();assert.equal(props.quality,'detailed');button('Quick').props.onClick();assert.equal(props.quality,'quick');assert.equal(qualityChanges,2);
props={...props,status:'rendering',message:'Rendering in Blender…',elapsed:9};assert.equal(nodes().find(node=>node.type==='fieldset').props.disabled,true);button('Cancel render').props.onClick();assert.equal(cancelCalls,1);
props={...props,status:'done',imageUrl:'blob:previous-snapshot',elapsed:25};button('Download').props.onClick();assert.equal(downloadCalls,1);button('Compare with live').props.onClick();assert.ok(rootNode().props.className.includes('snapshot-overlay--live'));assert.equal(button('Show snapshot').props['aria-pressed'],true);assert.ok(nodes().find(node=>node.type==='img').props.className.includes('snapshot-image--hidden'));
let blocked=false;rootNode().props.onPointerDown({stopPropagation:()=>{blocked=true;}});assert.ok(blocked);blocked=false;rootNode().props.onWheel({stopPropagation:()=>{blocked=true;}});assert.ok(blocked);
// A resized viewport must immediately reveal the snapshot and discard the old
// comparison toggle, even if the viewport later returns to its original shape.
props={...props,comparisonAvailable:false};assert.ok(!rootNode().props.className.includes('snapshot-overlay--live'));assert.equal(button('Compare unavailable').props.disabled,true);assert.equal(button('Compare unavailable').props['aria-describedby'],'snapshot-test-comparison-hint');assert.ok(!nodes().find(node=>node.type==='img').props.className.includes('snapshot-image--hidden'));button('Compare unavailable').props.onClick();assert.ok(!rootNode().props.className.includes('snapshot-overlay--live'));
props={...props,comparisonAvailable:true};assert.equal(button('Compare with live').props.disabled,false);assert.equal(button('Compare with live').props['aria-pressed'],false);button('Compare with live').props.onClick();assert.ok(rootNode().props.className.includes('snapshot-overlay--live'));
// Comparison and download remain available during an update; the prior URL
// remains mounted, so changing status alone cannot discard the saved image.
props={...props,status:'uploading',message:'Preparing this view',elapsed:1};assert.equal(nodes().find(node=>node.type==='img').props.src,'blob:previous-snapshot');assert.equal(button('Download').props.disabled,false);assert.equal(button('Show snapshot').props['aria-pressed'],true);assert.ok(!nodes().some(node=>node.props.className?.startsWith('snapshot-image-notice')),'Live comparison must not claim the previous image is visible');button('Show snapshot').props.onClick();assert.ok(!rootNode().props.className.includes('snapshot-overlay--live'));
props={...props,status:'error',message:'Blender stopped unexpectedly.'};assert.equal(nodes().find(node=>node.type==='img').props.src,'blob:previous-snapshot');button('Try again').props.onClick();assert.equal(renderCalls,2);assert.ok(nodes().some(node=>node.props.role==='alert'));
props={...props,status:'cancelled',message:''};button('Try again').props.onClick();assert.equal(renderCalls,3);props={...props,status:'done'};button('Render again').props.onClick();assert.equal(renderCalls,4);
button('Compare with live').props.onClick();button('Adjust shot').props.onClick();assert.equal(adjustCalls,1);assert.ok(rootNode().props.className.includes('snapshot-overlay--compose'));assert.equal(renderCalls,4,'Composing must never automatically render');assert.equal(document.activeElement,close,'Changing modes must leave focus inside the dialog');assert.equal(button('Download previous').props.disabled,false);assert.ok(nodes().find(node=>node.type==='img').props.className.includes('snapshot-image--hidden'));
button('Lighting').props.onClick();assert.equal(button('Lighting').props['aria-selected'],true);assert.equal(nodes().find(node=>node.props.id==='snapshot-test-camera-panel').props.hidden,true);
let tabFocused=false;const panelArrow={...key('ArrowLeft'),currentTarget:{parentElement:{querySelector(selector){assert.equal(selector,'[data-panel="camera"]');return{focus:()=>{tabFocused=true;}};}}}};button('Lighting').props.onKeyDown(panelArrow);assert.ok(panelArrow.prevented&&tabFocused);assert.equal(button('Camera').props['aria-selected'],true);
let toggle=nodes().find(node=>node.props.className==='snapshot-rail-toggle');assert.equal(toggle.props['aria-expanded'],true);toggle.props.onClick();assert.equal(nodes().find(node=>node.props.className==='snapshot-rail-body').props.hidden,true);nodes().find(node=>node.props.className==='snapshot-rail-toggle').props.onClick();assert.equal(nodes().find(node=>node.props.className==='snapshot-rail-body').props.hidden,false);
props={...props,status:'rendering'};assert.ok(!rootNode().props.className.includes('snapshot-overlay--compose'));assert.ok(!nodes().some(node=>node.props.className?.startsWith('snapshot-compose-rail')),'Camera and lighting controls cannot remain editable while rendering');assert.equal(button('Compare with live').props['aria-pressed'],false,'Adjusting the shot discards stale comparison state');props={...props,mode:'result',status:'done'};
const tab=key('Tab');document.activeElement=last;rootNode().props.onKeyDown(tab);assert.ok(tab.prevented);assert.equal(document.activeElement,close);
const reverse=key('Tab',true);rootNode().props.onKeyDown(reverse);assert.ok(reverse.prevented);assert.equal(document.activeElement,last,'Disabled, hidden and inert controls must be skipped');
document.activeElement=trigger;const outside=key('Tab');rootNode().props.onKeyDown(outside);assert.ok(outside.prevented);assert.equal(document.activeElement,close);
const normalTab=key('Tab');rootNode().props.onKeyDown(normalTab);assert.ok(!normalTab.prevented,'Interior forward Tab keeps native order');
candidates=[];const empty=key('Tab');rootNode().props.onKeyDown(empty);assert.ok(empty.prevented);assert.equal(document.activeElement,container);candidates=[close,last];
const escape=key('Escape');rootNode().props.onKeyDown(escape);assert.ok(escape.prevented&&escape.stopped);assert.equal(closeCalls,1);nodes().find(node=>node.type==='button'&&node.props.className?.includes('snapshot-button--back')).props.onClick();assert.equal(closeCalls,2);
slots.forEach(slot=>slot.cleanup?.());assert.equal(document.activeElement,trigger,'Closing Snapshot must restore the opener');
slots.length=0;effects.length=0;props={...props,mode:'compose',status:'idle',imageUrl:null};container.getBoundingClientRect=()=>({width:400,height:320});nodes();assert.equal(nodes().find(node=>node.props.className==='snapshot-rail-body').props.hidden,true,'A small canvas starts with controls collapsed to keep the tattoo visible');nodes().find(node=>node.props.className==='snapshot-rail-toggle').props.onClick();assert.equal(nodes().find(node=>node.props.className==='snapshot-rail-body').props.hidden,false,'Small screens can still open the full control rail');slots.forEach(slot=>slot.cleanup?.());
if(originalDocument===undefined)delete globalThis.document;else globalThis.document=originalDocument;delete globalThis.__snapshotHooks;
console.log(`SnapshotOverlay passed ${states} rendered state/quality/image cases; actual render/cancel/retry/download/compare/adjust handlers, composition tabs and collapse, busy control freeze, resized comparison reset, preserved prior image, pointer blocking, focus entry/trap/Escape/restore and safe elapsed time.`);
