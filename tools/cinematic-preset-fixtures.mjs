import fs from 'node:fs/promises';
import { build } from 'esbuild';
const result=await build({stdin:{contents:"export * from './src/render/cinematicPresets'; export * from './src/render/tattooCamera';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {CINEMATIC_PRESETS,cinematicLights,frameTattoo}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const framing={center:[0,.735,.34],normal:[0,0,1],up:[0,1,0],radius:.43,minDistance:.18,points:new Float32Array([-.3,.435,.34,.3,.435,.34,-.3,1.035,.34,.3,1.035,.34])};
const contracts=CINEMATIC_PRESETS.map(p=>{const camera=frameTattoo(framing,p.adjustment,.8,p.fov);return {id:p.id,schemaVersion:1,bodyMeshId:'body_full',skinToneId:'tone_03',poseId:'neutral',lookId:'studio_softbox',inkTextureUrl:'ink.png',bodyHair:'vellus',showEyes:false,bodyAppearance:{top:'none',bottom:'none',hairStyle:'none'},renderStyle:'cinematic',camera:{...camera,aspect:.8,preserveFraming:true,aperture:p.aperture,depthOfField:true},lighting:{presetName:'studio',intensityScale:1.1,lights:cinematicLights(p,camera)},studio:{mode:'plain',color:p.background,shadow:0,showGuides:false},output:{qualityTier:'final',width:960,height:1200,samples:256}};});
await fs.writeFile('/tmp/smartink-cinematic/contracts.json',JSON.stringify(contracts,null,2));
