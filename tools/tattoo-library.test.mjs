import assert from 'node:assert/strict';
import {build} from 'esbuild';
import React from 'react';
import {fileURLToPath} from 'node:url';
import {renderToStaticMarkup} from 'react-dom/server';
import {writeFile,unlink} from 'node:fs/promises';
const file=new URL('./.tattoo-library-test.mjs',import.meta.url);
const values=new Map();let pending=Promise.resolve();
globalThis.__tattooStore={get:async key=>values.get(key),update:(key,fn)=>{const result=pending.then(()=>values.set(key,fn(values.get(key))));pending=result.catch(()=>{});return result;}};
await build({stdin:{contents:"export * from './src/storage/tattooLibrary'; export {default as Panel} from './src/EditorLeftPanel';",resolveDir:process.cwd()},bundle:true,jsx:'automatic',format:'esm',platform:'node',outfile:fileURLToPath(file),packages:'external',plugins:[{name:'local-store',setup(b){b.onResolve({filter:/^idb-keyval$/},()=>({path:'idb',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const get=(...args)=>globalThis.__tattooStore.get(...args);export const update=(...args)=>globalThis.__tattooStore.update(...args);'}));}}]});
try{
const {STARTER_TATTOOS,loadTattooLibrary,rememberTattoo,removeTattoo,Panel}=await import(file.href);
assert.equal(STARTER_TATTOOS.length,3);assert.equal(new Set(STARTER_TATTOOS.map(a=>a.source)).size,3);
const png='data:image/png;base64,example';
await Promise.all([rememberTattoo(png,'Rose.png'),rememberTattoo(png,'Duplicate.png')]);
assert.equal((await loadTattooLibrary()).length,1);assert.equal((await loadTattooLibrary())[0].name,'Rose');
await rememberTattoo('data:image/png;base64,second','Second.png');assert.equal((await loadTattooLibrary()).length,2);
await rememberTattoo('/tattoos/lunar-moth.png');assert.equal((await loadTattooLibrary()).length,2,'Starter assets must not become uploads');
const selected=(await loadTattooLibrary())[0];await removeTattoo(selected.id);assert.equal((await loadTattooLibrary()).length,1);
const props={bodyLabel:'Full figure',studioLabel:'Studio sweep',activeTab:'tattoo',onSelect:()=>{},collapsed:false,onToggleCollapsed:()=>{},tattooVisible:true,onToggleTattoo:()=>{},currentImage:STARTER_TATTOOS[0].source,onChooseArtwork:()=>{}};
const html=renderToStaticMarkup(React.createElement(Panel,props));
for(const name of ['Botanical rose','Lunar moth','Ornamental dagger','Search tattoo designs','Starter designs','My uploads','Add artwork'])assert.ok(html.includes(name),name);
assert.match(html,/aria-label="Use Botanical rose" aria-pressed="true"/);
assert.match(html,/multiple=""/);assert.match(html,/Uploads stay in this browser/);
const collapsed=renderToStaticMarkup(React.createElement(Panel,{...props,collapsed:true}));assert.match(collapsed,/class="asset-library-body" hidden=""/);
console.log('Tattoo library: saved uploads, concurrent duplicate imports, reload reads, removal, starter separation, thumbnail selection markup and collapsed layout passed.');
}finally{await unlink(file);delete globalThis.__tattooStore;}
