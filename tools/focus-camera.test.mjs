/** Visible-boundary geometry and actual Workspace view/focus request wiring. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {build, transform} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const result=await build({stdin:{contents:"export * from './src/render/focusCamera';export * from './src/render/focusGeometry';export * as THREE from 'three';",resolveDir:root,loader:'ts'},bundle:true,platform:'node',format:'esm',write:false});
const {THREE,fitRegionCamera,levelFocusDirection,visibleRegionPoints,framingFromPoints,regionAtTriangle}=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([-2,0,0, 2,0,0, 0,2,0],3));geometry.setIndex([0,1,2]);
const matrix=new THREE.Matrix4().makeTranslation(3,4,5),field=new Float32Array([-1,1,-1]);
const clipped=visibleRegionPoints(geometry,matrix,field);
assert.deepEqual(Array.from(clipped),[5,4,5,3,4,5,4,5,5],'framing includes the two precise zero-contour edge points');
assert.deepEqual(Array.from(visibleRegionPoints(geometry,matrix,new Float32Array([-1,-1,-1]))),[]);
assert.equal(framingFromPoints(new Float32Array()),null);
assert.deepEqual(framingFromPoints(clipped).center,[4,4.5,5]);
assert.deepEqual(Array.from(field),[-1,1,-1]);assert.equal(geometry.attributes.position.getX(0),-2,'focus does not move the mesh');
for(let i=0;i<=10;i++)for(let j=0;j<=10-i;j++)assert.ok([0,3].includes(regionAtTriangle([0,3,0],new THREE.Vector3(i/10,j/10,1-(i+j)/10))),'hover never invents a missing category');
for(const direction of [[0,8,0],[0,-8,0],[0,0,0],[NaN,1,0]])assert.deepEqual(levelFocusDirection(direction),[0,0,1]);
assert.deepEqual(levelFocusDirection([0,8,-9]),[0,0,-1],'Focus keeps front/back side but removes elevation');
const frame={center:[1.2,.8,-.3],radius:2,points:Float32Array.from([-.1,-1,-.4,2.2,2.6,-.2,2,2,.4])};
for(const aspect of [.25,.6,1,2.5])for(const direction of [[0,0,1],[0,0,-1],[1,0,1],[0,1,0],[0,-1,0]]){
 const view=fitRegionCamera(frame,direction,45,aspect),camera=new THREE.PerspectiveCamera(view.fov,aspect,.01,100);camera.position.fromArray(view.position);camera.lookAt(...view.target);camera.updateMatrixWorld(true);
 for(let i=0;i<frame.points.length;i+=3){const p=new THREE.Vector3().fromArray(frame.points,i).project(camera);assert.ok(Math.abs(p.x)<=1/1.15+1e-5&&Math.abs(p.y)<=1/1.15+1e-5,'cut points remain inside the padded frame');}
}
const source=await fs.readFile(new URL('../src/Workspace.tsx',import.meta.url),'utf8');
const definitions=source.slice(source.indexOf('const CAMERA_PRESETS:'),source.indexOf('// OrbitControls owns camera changes'));
const focus=source.slice(source.indexOf('  const handleFrameRegion ='),source.indexOf("  const [lookId, setLookId]"));
const presets=source.slice(source.indexOf('  const handleCameraPresetChange ='),source.indexOf('  // Export functionality'));
const keys=['useCallback','uvPlacementRef','orbitControlsRef','canvasHostRef','setCameraState','setCameraRequestId','setCameraPreset','frameRegionCamera','levelFocusDirection'];
const compiled=await transform(`(function(${keys.join(',')}) { ${definitions}\n${focus}\n${presets}\nreturn {handleFrameRegion,handleCameraPresetChange};})`,{loader:'ts'});
let state={position:[0,8,0],target:[0,0,0],fov:60},requests=0,preset='front';
const live={position:[8,7,0],target:[2,1,0],fov:50};
const env={useCallback:fn=>fn,uvPlacementRef:{current:{getRegionFraming:()=>frame}},orbitControlsRef:{current:{getSnapshot:()=>live}},canvasHostRef:{current:{getBoundingClientRect:()=>({width:500,height:800})}},setCameraState:value=>{state=typeof value==='function'?value(state):value;},setCameraRequestId:update=>{requests=update(requests);},setCameraPreset:value=>{preset=value;},frameRegionCamera:fitRegionCamera,levelFocusDirection};
const handlers=(0,eval)(compiled.code)(...keys.map(key=>env[key]));
handlers.handleFrameRegion(null);assert.equal(requests,0);
handlers.handleFrameRegion(frame);assert.equal(requests,1);assert.equal(preset,'custom');assert.equal(state.position[1],state.target[1]);assert.ok(state.position[0]>state.target[0]);assert.equal(state.fov,45,'Focus starts from the actual current orbit and uses a comfortable level lens');
for(const key of ['front','back','left','right','top','bottom','threeQuarter','profile','closeup','wide']){handlers.handleCameraPresetChange(key);assert.equal(preset,key);assert.ok(state.position.every(Number.isFinite));}
assert.equal(requests,11,'every explicit view click starts a transition request');
handlers.handleCameraPresetChange('front');const normalDistance=new THREE.Vector3(...state.position).distanceTo(new THREE.Vector3(...state.target));
handlers.handleCameraPresetChange('wide');assert.ok(new THREE.Vector3(...state.position).distanceTo(new THREE.Vector3(...state.target))>normalDistance);
assert.match(source,/camera=\{INITIAL_CANVAS_CAMERA\}/,'Canvas cannot jump directly to requested destination');
assert.match(source,/cameraRequestId=\{cameraRequestId\}/);
geometry.dispose();
console.log('Focus camera passed: exact cut-edge bounds, no phantom picking categories, portrait/landscape fits, level focus from live orbit, all view requests and stable Canvas camera.');
