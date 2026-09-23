/** Production pose UI, migration and outbound contract; no browser dependency. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root=fileURLToPath(new URL('../',import.meta.url));
const hooks=`export const useState=(...a)=>globalThis.__poseHooks.useState(...a);export const useId=()=> 'pose-test';export const useRef=v=>({current:v});`;
const {outputFiles}=await build({stdin:{contents:`export { default as PoseControls } from './src/PoseControls'; export * from './src/render/bodyPose'; export {migrateScene} from './src/storage/sceneStoreTypes'; export {buildRenderContract,validateContract} from './src/render/buildContract';`,resolveDir:root,loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',jsx:'automatic',loader:{'.css':'empty'},plugins:[{name:'controlled-react',setup(b){b.onResolve({filter:/^react(?:\/jsx-runtime)?$/},a=>({path:a.path,namespace:'hooks'}));b.onLoad({filter:/.*/,namespace:'hooks'},a=>({contents:a.path==='react'?hooks:'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";'}));}}]});
const api=await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const {BODY_POSE_KEYS,BODY_POSE_BOUNDS,BODY_POSE_PRESETS,DEFAULT_BODY_POSE,normalizePose,poseFromPreset,migrateScene,buildRenderContract,validateContract}=api;
const fixture={id:'pose-scene',name:'Pose test',model:'FinalBaseMesh',decalImage:null,decalRotation:0,decalScale:1,decalColor:'#000000',decalOpacity:1,decalVisible:false,lightingPreset:'studio',background:'white',thumbnail:null,camera:{position:[0,0,8],target:[0,0,0],fov:45},createdAt:new Date(),updatedAt:new Date(),createdBy:'test'};
assert.deepEqual(migrateScene(fixture).bodyPose,DEFAULT_BODY_POSE,'older scenes remain neutral');
assert.equal(migrateScene({...fixture,poseId:'arm_extended'}).poseId,'arms_out');
for(const preset of BODY_POSE_PRESETS){const scene=migrateScene({...fixture,poseId:preset.id});assert.deepEqual(scene.bodyPose,poseFromPreset(preset.id));assert.equal(scene.poseId,preset.id);}
const custom=normalizePose({leftElbow:25,rightKnee:12,headTilt:5});
assert.deepEqual(migrateScene({...fixture,poseId:'neutral',bodyPose:custom}).bodyPose,custom,'explicit angles win over a stale preset label');
assert.equal(migrateScene({...fixture,poseId:'neutral',bodyPose:custom}).poseId,'custom');
assert.equal(migrateScene({...fixture,poseId:'flex',bodyPose:{}}).poseId,'neutral','explicit empty angle set is neutral');
assert.equal(migrateScene({...fixture,poseId:'unknown'}).poseId,'neutral');
const incoming={...custom,leftElbow:999,headTurn:NaN};const migrated=migrateScene({...fixture,bodyPose:incoming});
assert.equal(migrated.bodyPose.leftElbow,BODY_POSE_BOUNDS.leftElbow.max);assert.equal(migrated.bodyPose.headTurn,0);assert.equal(incoming.leftElbow,999,'migration must not mutate incoming settings');
const shot={position:[0,0,8],target:[0,0,0],fov:45,aspect:1};
for(const preset of BODY_POSE_PRESETS){const contract=buildRenderContract({bodyMeshId:'body_full',skinToneId:'tone_03',poseId:preset.id,lookId:'studio_softbox',qualityTier:'preview'},shot,'ink.png',{width:512,height:512});assert.deepEqual(contract.bodyPose,poseFromPreset(preset.id));assert.deepEqual(validateContract(contract),[]);}
const contract=buildRenderContract({bodyMeshId:'body_full',skinToneId:'tone_03',poseId:'custom',bodyPose:custom,lookId:'studio_softbox',qualityTier:'preview'},shot,'ink.png',{width:512,height:512});
assert.deepEqual(contract.bodyPose,custom);assert.notEqual(contract.bodyPose,custom);assert.deepEqual(validateContract(contract),[]);
for(const [bodyPose,pattern]of [[{leftElbow:999},/bodyPose.leftElbow/],[{headTurn:Infinity},/bodyPose.headTurn/],[{unknown:1},/unknown bodyPose/]])assert.ok(validateContract({...contract,bodyPose}).some(x=>pattern.test(x)));
for(const bodyPose of [null,[],false])assert.ok(validateContract({...contract,bodyPose}).includes('bodyPose must be an object'));
assert.ok(validateContract({...contract,bodyPose:undefined}).includes('custom pose requires bodyPose'));
assert.ok(validateContract({...contract,bodyPose:{leftArmForward:35,leftElbow:85}}).some(x=>x.startsWith('bodyPose.')));

function flatten(tree,out=[]){if(Array.isArray(tree))tree.forEach(t=>flatten(t,out));else if(tree&&typeof tree==='object'){out.push(tree);flatten(tree.props?.children,out);}return out;}
const state=[];let cursor=0,bodyPose={...DEFAULT_BODY_POSE},poseId='neutral',framed=0,tree;
globalThis.__poseHooks={useState(initial){const n=cursor++;if(!(n in state))state[n]=initial;return[state[n],value=>state[n]=value];}};
function render(){cursor=0;tree=api.PoseControls({poseId,bodyPose,onBodyPoseChange:p=>{bodyPose=p;poseId='custom';},onPosePresetChange:id=>{poseId=id;bodyPose=poseFromPreset(id);},onHighlightRegions:()=>{},onFramePose:()=>framed++});return flatten(tree);}
const button=label=>render().find(n=>n.type==='button'&&n.props.children===label);
function select(label){const control=button(label);assert.ok(control,`visible ${label} selector`);control.props.onClick();}
select('Bent arms');assert.deepEqual(bodyPose,poseFromPreset('flex'));
select('Reset pose');assert.deepEqual(bodyPose,DEFAULT_BODY_POSE);
for(const label of ['Left arm','Right arm','Left leg','Right leg','Head']){
 select(label);const inputs=render().filter(n=>typeof n.type==='function'&&n.props.ariaLabel);assert.equal(inputs.length,label==='Head'?2:3);
 for(const input of inputs){input.props.onChange(999);assert.ok(Object.values(bodyPose).every(Number.isFinite));input.props.onChange(0);}
}
select('Left arm');render().find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});
let input=render().find(n=>typeof n.type==='function'&&n.props.ariaLabel);input.props.onChange(999);
assert.equal(bodyPose.leftArmLift,BODY_POSE_BOUNDS.leftArmLift.max);assert.equal(bodyPose.rightArmLift,BODY_POSE_BOUNDS.rightArmLift.max,'linked limbs move together');
input.props.onChange(0);assert.equal(bodyPose.leftArmLift,0);assert.equal(bodyPose.rightArmLift,0,'linked reset affects both sides');
input.props.onChange(NaN);assert.equal(bodyPose.leftArmLift,0);
render().find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:false}});
input=render().find(n=>typeof n.type==='function'&&n.props.ariaLabel);input.props.onChange(10);assert.equal(bodyPose.leftArmLift,10);assert.equal(bodyPose.rightArmLift,0,'independent limbs remain separate');
select('Frame pose');assert.equal(framed,1);select('Reset pose');assert.deepEqual(bodyPose,DEFAULT_BODY_POSE);
const range=key=>render().find(n=>typeof n.type==='function'&&n.props.id?.endsWith(`-${key}-input`));
select('Left arm');
range('leftElbow').props.onChange(85);
assert.equal(range('leftArmForward').props.max,15,'shoulder range adapts to the existing elbow bend');
range('leftArmForward').props.onChange(35);
assert.equal(bodyPose.leftArmForward,15);assert.equal(bodyPose.leftElbow,85,'editing shoulder leaves the elbow unchanged');
range('leftElbow').props.onChange(0);
range('leftArmForward').props.onChange(35);
assert.equal(range('leftElbow').props.max,65);
range('leftElbow').props.onChange(85);
assert.equal(bodyPose.leftElbow,65);assert.equal(bodyPose.leftArmForward,35,'editing elbow leaves the shoulder unchanged');
render().find(n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});
assert.equal(bodyPose.rightElbow,65);assert.equal(bodyPose.rightArmForward,35,'enabling linking mirrors the selected limb');
range('leftElbow').props.onChange(60);
assert.equal(bodyPose.leftElbow,60);assert.equal(bodyPose.rightElbow,60);
select('Arm showcase');
assert.equal(render().find(n=>n.type==='input'&&n.props.type==='checkbox').props.checked,false,'asymmetric presets switch linking off');
select('Reset pose');assert.deepEqual(bodyPose,DEFAULT_BODY_POSE);
range('leftArmLift').props.onChange(-10);
assert.equal(range('leftArmForward').props.max,25,'lowered shoulder has less forward room');
range('leftArmForward').props.onChange(35);
assert.equal(bodyPose.leftArmLift,-10);assert.equal(bodyPose.leftArmForward,25);
range('leftArmLift').props.onChange(0);
range('leftArmForward').props.onChange(35);
assert.equal(range('leftArmLift').props.min,0);
range('leftArmLift').props.onChange(-10);
assert.equal(bodyPose.leftArmLift,0);assert.equal(bodyPose.leftArmForward,35,'lowering cannot silently move the shoulder forward angle');
select('Reset pose');
assert.equal(BODY_POSE_KEYS.length,14);
delete globalThis.__poseHooks;
console.log('Pose controls passed: presets, per-side/linked controls, clamping, joint/whole reset, framing, legacy migration, saved angle priority and exported contract validation.');
