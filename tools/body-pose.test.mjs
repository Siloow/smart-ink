/** Actual production shape→pose pipeline on real GLBs, including real UV tangents. */
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {loadPoseModules,poseCases,poseFixture,applyPoseCase} from './body-pose-visual-lib.mjs';
const modules=await loadPoseModules(),{pose,shape}=modules;
const original={leftElbow:1000,rightArmLift:-1000,headTurn:NaN};
assert.deepEqual(pose.normalizePose(null),pose.DEFAULT_BODY_POSE);
const normalized=pose.normalizePose(original);assert.equal(normalized.leftElbow,pose.BODY_POSE_BOUNDS.leftElbow.max);assert.equal(normalized.rightArmLift,pose.BODY_POSE_BOUNDS.rightArmLift.min);assert.equal(normalized.headTurn,0);assert.equal(original.leftElbow,1000);
for(const key of pose.BODY_POSE_KEYS){const b=pose.BODY_POSE_BOUNDS[key];assert.equal(pose.clampPoseValue(key,Infinity),0);assert.equal(pose.clampPoseValue(key,-1e6),b.min);assert.equal(pose.clampPoseValue(key,1e6),b.max);}
for(const side of ['left','right']){
 const elbow=`${side}Elbow`,forward=`${side}ArmForward`,lift=`${side}ArmLift`,loaded=pose.normalizePose({[elbow]:1e6,[forward]:1e6});
 assert.ok(loaded[elbow]<=pose.poseBoundsForKey(elbow,loaded).max,'loaded joints respect their combined limit');
 assert.ok(loaded[forward]<=pose.poseBoundsForKey(forward,loaded).max,'forward movement respects the existing elbow bend');
 assert.ok(pose.poseBoundsForKey(forward,{[elbow]:pose.BODY_POSE_BOUNDS[elbow].max}).max<pose.BODY_POSE_BOUNDS[forward].max,'UI exposes the smaller safe range for a bent elbow');
 assert.ok(pose.poseBoundsForKey(forward,{[lift]:pose.BODY_POSE_BOUNDS[lift].min}).max<pose.BODY_POSE_BOUNDS[forward].max,'lowered arm has less forward movement');
 assert.ok(pose.poseBoundsForKey(lift,{[forward]:pose.BODY_POSE_BOUNDS[forward].max}).min>pose.BODY_POSE_BOUNDS[lift].min,'forward arm limits how far it can be lowered');
}
assert.deepEqual(pose.poseFromPreset('arm_extended'),pose.poseFromPreset('arms_out'),'legacy pose migration');
assert.deepEqual(pose.poseFromPreset('missing'),pose.DEFAULT_BODY_POSE,'unknown preset restores neutral');
const cases=poseCases(modules);let seed=0x260923;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
for(let i=0;i<32;i++)cases.push({id:`random-${i}`,pose:Object.fromEntries(pose.BODY_POSE_KEYS.map(k=>{const b=pose.BODY_POSE_BOUNDS[k];return[k,i<16?(random()<.5?b.min:b.max):b.min+random()*(b.max-b.min)];})),shape:i%4===0?Object.fromEntries(shape.BODY_SHAPE_KEYS.map(k=>[k,random()*2-1])):{}});
for(const preset of pose.BODY_POSE_PRESETS)for(const amount of [.25,.5,.75])cases.push({id:`transition-${preset.id}-${amount}`,pose:Object.fromEntries(Object.entries(preset.values).map(([k,v])=>[k,v*amount]))});
function quality(before,after){
 let collapsed=0,minArea=Infinity,maxEdge=0,minEdge=Infinity;
 for(let i=0;i<before.length;i+=9){
  const old=[],next=[];
  for(let k=1;k<=2;k++){old.push([0,1,2].map(a=>before[i+k*3+a]-before[i+a]));next.push([0,1,2].map(a=>after[i+k*3+a]-after[i+a]));}
  const cross=(a,b)=>Math.hypot(a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]);
  const oa=cross(...old),na=cross(...next);if(oa>1e-12){const ratio=na/oa;minArea=Math.min(minArea,ratio);if(ratio<.05)collapsed++;}
  for(let k=0;k<3;k++){const a=i+k*3,b=i+(k+1)%3*3,ol=Math.hypot(...[0,1,2].map(n=>before[a+n]-before[b+n])),nl=Math.hypot(...[0,1,2].map(n=>after[a+n]-after[b+n]));if(ol>1e-8){const ratio=nl/ol;minEdge=Math.min(minEdge,ratio);maxEdge=Math.max(maxEdge,ratio);}}
 }return{collapsed,minArea,minEdge,maxEdge};
}
function distance(p,a,b){return Math.hypot(p[a*3]-p[b*3],p[a*3+1]-p[b*3+1],p[a*3+2]-p[b*3+2]);}
function rigidError(before,after,ids){let worst=0;for(let a=0;a<ids.length;a++)for(let b=a+1;b<ids.length;b++)worst=Math.max(worst,Math.abs(distance(before,ids[a],ids[b])-distance(after,ids[a],ids[b])));return worst;}
function tangentDot(tangent,positions,a,b){const offset=a*4,pa=a*3,pb=b*3;return(tangent[offset]*(positions[pb]-positions[pa])+tangent[offset+1]*(positions[pb+1]-positions[pa+1])+tangent[offset+2]*(positions[pb+2]-positions[pa+2]))/distance(positions,a,b);}
const failures=[],timings=[];let total=0,worstStretch=0,worstArea=Infinity;
for(const sex of ['male','female']){
 const fixture=await poseFixture(sex,modules),g=fixture.geometry,d=fixture.prepared,base=d.base,H=fixture.bounds.maxY-fixture.bounds.minY,cx=(fixture.bounds.maxX+fixture.bounds.minX)/2,halfW=(fixture.bounds.maxX-fixture.bounds.minX)/2;
 const groups={leftHand:[],rightHand:[],leftFoot:[],rightFoot:[],head:[]};
 for(const i of d.unique){const h=(base[i*3+1]-fixture.bounds.minY)/H,u=(base[i*3]-cx)/halfW;if(h<.5&&u>.82)groups.leftHand.push(i);if(h<.5&&u<-.82)groups.rightHand.push(i);if(h<.065&&u>.01)groups.leftFoot.push(i);if(h<.065&&u<-.01)groups.rightFoot.push(i);if(h>.91)groups.head.push(i);}
 for(const [name,ids]of Object.entries(groups)){assert.ok(ids.length>20,`${sex}: ${name} sample`);groups[name]=ids.filter((_,i)=>i%Math.max(1,Math.floor(ids.length/32))===0).slice(0,40);}
 const atlas=g.attributes.uv.array.slice(),tattoo=g.attributes.aTattooUv.array.slice(),tattooMask=g.attributes.aTattooMask.array.slice(),tangents=g.attributes.tangent.array.slice(),anchors=JSON.parse(JSON.stringify(fixture.anchors));
 let movedHandTangent=false;
 for(const spec of cases){
  const normalizedPose=pose.normalizePose(spec.pose);assert.deepEqual(pose.normalizePose(normalizedPose),normalizedPose,'pose normalization is idempotent');
  for(const key of pose.BODY_POSE_KEYS){const bounds=pose.poseBoundsForKey(key,normalizedPose);assert.ok(normalizedPose[key]>=bounds.min-1e-8&&normalizedPose[key]<=bounds.max+1e-8,`${spec.id}: valid linked limits for ${key}`);}
  const start=performance.now(),before=applyPoseCase(fixture,modules,spec);timings.push(performance.now()-start);const after=g.attributes.position.array,currentTangents=g.attributes.tangent.array;
  assert.ok(after.every(Number.isFinite)&&g.attributes.normal.array.every(Number.isFinite),`${sex}/${spec.id}: finite geometry`);
  const measured=quality(before,after);worstArea=Math.min(worstArea,measured.minArea);worstStretch=Math.max(worstStretch,measured.maxEdge);
  if(measured.collapsed)failures.push(`${sex}/${spec.id}: ${measured.collapsed} triangles below5% area (minimum${measured.minArea.toFixed(3)})`);
  if(measured.maxEdge>4.5)failures.push(`${sex}/${spec.id}: edge stretched ${measured.maxEdge.toFixed(2)}x beyond the validated envelope`);
  for(const [name,ids]of Object.entries(groups))assert.ok(rigidError(before,after,ids)<H*2e-6,`${sex}/${spec.id}: ${name} retains rigid distances`);
  for(let i=0;i<d.source.length;i++){const representative=d.source[i];if(representative!==i)for(let axis=0;axis<3;axis++)assert.equal(after[i*3+axis],after[representative*3+axis],`${sex}/${spec.id}: no seam separation`);}
  assert.deepEqual(g.attributes.uv.array,atlas,`${sex}/${spec.id}: original atlas unchanged`);assert.deepEqual(g.attributes.aTattooUv.array,tattoo,`${sex}/${spec.id}: tattoo chart unchanged`);assert.deepEqual(g.attributes.aTattooMask.array,tattooMask,`${sex}/${spec.id}: chart face coverage unchanged`);assert.deepEqual(fixture.anchors,anchors);
  for(let i=0;i<currentTangents.length;i+=4){assert.equal(currentTangents[i+3],tangents[i+3],`${sex}/${spec.id}: tangent handedness retained`);const beforeLength=Math.hypot(tangents[i],tangents[i+1],tangents[i+2]),afterLength=Math.hypot(currentTangents[i],currentTangents[i+1],currentTangents[i+2]);assert.ok(Number.isFinite(afterLength)&&Math.abs(beforeLength-afterLength)<2e-5,`${sex}/${spec.id}: tangent length retained`);}
  for(const part of ['leftHand','rightHand']){
   const ids=groups[part],a=ids[0],b=ids.reduce((best,i)=>distance(before,a,i)>distance(before,a,best)?i:best,ids[1]);
   assert.ok(Math.abs(tangentDot(tangents,before,a,b)-tangentDot(currentTangents,after,a,b))<1e-5,`${sex}/${spec.id}: tangent rotates with rigid hand`);
   if(Math.hypot(...[0,1,2].map(k=>currentTangents[a*4+k]-tangents[a*4+k]))>.1)movedHandTangent=true;
  }
  if(spec.id==='neutral'){assert.deepEqual(after,before,`${sex}: neutral positions exact`);assert.deepEqual(currentTangents,tangents,`${sex}: neutral tangents exact`);}
  total++;
 }
 assert.ok(movedHandTangent,`${sex}: tangent pose path actually exercised`);
 applyPoseCase(fixture,modules,{pose:{},shape:{}});assert.deepEqual(g.attributes.position.array,base,`${sex}: exact neutral reset after edit history`);assert.deepEqual(g.attributes.tangent.array,tangents,`${sex}: exact tangent reset`);
 const target={pose:pose.poseFromPreset('arm_showcase'),shape:{build:.8,arms:-.4}};applyPoseCase(fixture,modules,target);const targetPositions=g.attributes.position.array.slice(),targetTangents=g.attributes.tangent.array.slice();applyPoseCase(fixture,modules,{pose:pose.poseFromPreset('step'),shape:{height:-1}});applyPoseCase(fixture,modules,target);assert.deepEqual(g.attributes.position.array,targetPositions,`${sex}: repeated target does not accumulate posing`);assert.deepEqual(g.attributes.tangent.array,targetTangents,`${sex}: tangent poses do not accumulate`);
 console.log(`${sex}: ${cases.length} poses audited, rigid hands/feet/head, UV anchors, tangent frames, seams, reset and repeatability passed.`);
}
timings.sort((a,b)=>a-b);console.log(`Pose audit ${total} cases: minimum triangle area ratio ${worstArea.toFixed(3)}, max edge stretch ${worstStretch.toFixed(2)}x, shape+pose p50 ${timings[Math.floor(timings.length*.5)].toFixed(1)}ms p95 ${timings[Math.floor(timings.length*.95)].toFixed(1)}ms.`);
assert.equal(failures.length,0,failures.slice(0,16).join('\n'));
