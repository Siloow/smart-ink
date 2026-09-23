/** Exercise the production snapshot session and client against a running Blender server.
 * This uses a reproducible studio shot; it does not access browser state.
 * SMARTINK_TEST_FIXTURE_DIR optionally supplies contract.json + ink.png.
 * SMARTINK_TEST_OUTPUT_DIR optionally changes the local evidence directory. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { build } from 'esbuild';
const server = process.env.SMARTINK_TEST_SERVER ?? 'http://127.0.0.1:8000';
const { outputFiles } = await build({stdin:{contents:"export * from './src/services/snapshotSession'; export * from './src/services/cloudRenderService'; export * from './src/render/buildContract'; export * from './src/config/lightingPresets';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,define:{'import.meta.env.DEV':'true','import.meta.env.VITE_RENDER_URL':JSON.stringify(server)}});
const api=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const readiness=await api.getRenderServerStatus();if(!readiness.ready)throw Error(readiness.message);
function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(name,data){const kind=Buffer.from(name),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);kind.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([kind,data])),data.length+8);return out;}
const header=Buffer.alloc(13);header.writeUInt32BE(1,0);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
let ink=new Blob([Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(5))),chunk('IEND',Buffer.alloc(0))])],{type:'image/png'});
let contract=api.buildRenderContract({bodyMeshId:'body_full_female',skinToneId:'tone_03',poseId:'neutral',lookId:'studio_softbox',qualityTier:'final',finalSamples:64,bodyAppearance:{top:'tshirt',bottom:'trousers',topColor:'#e8e3d9',bottomColor:'#263449',hairStyle:'short',hairTone:'brown'},studio:{mode:'sweep',color:'#657b91',shadow:.6,showGuides:false}}, {position:[3,.4,8.5],target:[0,0,0],fov:34,aspect:.8},'ink.png',{width:768,height:960},{presetName:'studio',intensityScale:api.LIGHTING_PRESETS.studio.threeIntensityScale,lights:api.resolveRig('studio')});
const fixture=process.env.SMARTINK_TEST_FIXTURE_DIR;
if(fixture){
 const [json,png]=await Promise.all([fs.readFile(path.resolve(fixture,'contract.json'),'utf8'),fs.readFile(path.resolve(fixture,'ink.png'))]);
 contract=JSON.parse(json);ink=new Blob([png],{type:'image/png'});
}
const output=path.resolve(process.env.SMARTINK_TEST_OUTPUT_DIR??'reports/snapshot/server');await fs.mkdir(output,{recursive:true});
let resolveResult,rejectResult;const finished=new Promise((resolve,reject)=>{resolveResult=resolve;rejectResult=reject;});
const start=Date.now();let lastStatus='';
const session=api.createSnapshotSession({render:api.renderContract,retain:async(shot,url)=>{
 try {
  const png=await fetch(url).then(r=>r.arrayBuffer());await fs.writeFile(path.join(output,'snapshot.png'),Buffer.from(png));await fs.writeFile(path.join(output,'contract.json'),JSON.stringify(shot.contract,null,2)+'\n');
  console.log(`Saved ${output}/snapshot.png in ${((Date.now()-start)/1000).toFixed(1)}s`);resolveResult();
 }catch(error){rejectResult(error);throw error;}
}});
const unsubscribe=session.subscribe(()=>{const state=session.getState();if(state.status!==lastStatus){console.log(state.status,state.message);lastStatus=state.status;}if(state.status==='error'||state.status==='cancelled')rejectResult(Error(state.message));});
try{session.open(async()=>({contract,inkBlob:ink,sceneName:fixture?'Example tattoo snapshot proof':'Studio snapshot proof'}));void session.render();await finished;}finally{unsubscribe();session.close();}
