import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { build } from 'esbuild';
import * as THREE from 'three';
import { OBJLoader } from 'three-stdlib';

const root = fileURLToPath(new URL('../', import.meta.url));
const source = fs.readFileSync(path.join(root, 'src/landing/HeroPreview.tsx'), 'utf8');
const ast = ts.createSourceFile('hero.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['stripLooseEdges', 'standUpright', 'faceHandForward', 'measureBands', 'median', 'frameOnShaft', 'poseHeroHand'];
const funcs = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n => n.getText(ast)).join('\n');
const js = ts.transpile(funcs, { target: ts.ScriptTarget.ES2022 });
const normalize = new Function('THREE', `const HAND_FACE_TURN=0,TARGET_WIDTH=1,VIEW_CENTER_Y=-1.8;${js};return geo=>{standUpright(geo);faceHandForward(geo);frameOnShaft(geo);poseHeroHand(geo)}`)(THREE);
const parsed = new OBJLoader().parse(fs.readFileSync(path.join(root, 'public/models/forearm.obj'), 'utf8').replace(/^l[ \t].*$/gm, ''));
let original;
parsed.traverse(o => { if (o.isMesh && !original) original = o.geometry; });
normalize(original);
const originalPositions = original.getAttribute('position').array.slice();
const { outputFiles } = await build({
  stdin: { contents: "export * from './src/landing/heroTattooPlacement.ts'; export * from './src/render/surfacePlacement.ts';", resolveDir: root, loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const api = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const surface = api.createInitialHeroTattoo(original);
assert(surface.anchor && surface.chart, 'initial emblem must resolve on the real forearm');
assert.notEqual(surface.geometry, original);
assert.equal(surface.geometry.index, null, 'independent triangle corners are required for fold masks');
assert(!original.getAttribute('aTattooUv'), 'cached OBJ must stay untouched');
assert.deepEqual(originalPositions, original.getAttribute('position').array);
const other = api.createInitialHeroTattoo(original);
const otherUv = other.geometry.getAttribute('aTattooUv').array.slice();
const topology = api.createSurfaceTopology(surface.geometry);
const material = new THREE.MeshBasicMaterial();
const mesh = new THREE.Mesh(surface.geometry, material);
mesh.updateMatrixWorld(true);
const cases = [
  { name:'front', angle:0, height:.7 },
  { name:'side', angle:1.2, height:1.0 },
  { name:'back', angle:Math.PI, height:1.0 },
  { name:'wrist', angle:0, height:.08 },
  { name:'hand', angle:0, height:-.4 },
];
let placed = 0;
for (const item of cases) {
  const origin = new THREE.Vector3(Math.sin(item.angle) * 4, item.height, Math.cos(item.angle) * 4);
  const direction = new THREE.Vector3(-Math.sin(item.angle), 0, -Math.cos(item.angle));
  const hit = new THREE.Raycaster(origin, direction).intersectObject(mesh)[0];
  assert(hit, `${item.name}: ray must reach the model`);
  const anchor = api.heroAnchorFromHit(hit);
  assert(anchor, `${item.name}: valid barycentric anchor`);
  const before = surface.geometry.getAttribute('aTattooUv');
  const expected = api.buildSurfaceChart(topology, surface.geometry, mesh.matrixWorld, anchor);
  const accepted = surface.place(anchor, mesh.matrixWorld);
  assert.equal(accepted, !!expected && expected.maxSize >= .045, `${item.name}: editor acceptance parity`);
  if (!accepted) { assert.equal(surface.geometry.getAttribute('aTattooUv'), before); console.log(item.name, 'safely rejected'); continue; }
  placed++;
  assert.deepEqual(surface.geometry.getAttribute('aTattooUv').array, expected.uv, `${item.name}: same map as editor`);
  const expectedMask = expected.mask.slice();
  for (let f=0; f<expected.faceMask.length; f++) if (expected.faceMask[f]<.5) expectedMask.fill(0, f*3, f*3+3);
  assert.deepEqual(surface.geometry.getAttribute('aTattooMask').array, expectedMask, `${item.name}: same whole-face rejection as editor`);
  const uv = surface.geometry.getAttribute('aTattooUv');
  const centerUv = new THREE.Vector2();
  for (let k=0;k<3;k++) centerUv.addScaledVector(new THREE.Vector2().fromBufferAttribute(uv, anchor.faceIndex*3+k), anchor.barycentric[k]);
  assert(centerUv.length() < 1e-6, `${item.name}: artwork centered at the actual hit`);
  const originalMask = surface.geometry.getAttribute('aTattooMask').array.slice();
  const originalUv = uv.array.slice();
  mesh.rotation.y = .45; mesh.updateMatrixWorld(true);
  const worldCenter = surface.center.clone().applyMatrix4(mesh.matrixWorld);
  const roundTrip = worldCenter.clone().applyMatrix4(mesh.matrixWorld.clone().invert());
  assert(roundTrip.distanceTo(surface.center)<1e-8, 'focus follows exact skin point');
  assert.deepEqual(uv.array, originalUv, 'orbit must not slide or rebuild the ink');
  assert.deepEqual(surface.geometry.getAttribute('aTattooMask').array, originalMask);
  mesh.rotation.y = 0; mesh.updateMatrixWorld(true);
  console.log(item.name, 'placed; safe size', expected.maxSize.toFixed(3));
}
assert(placed>=3, 'front, side and back should all accept surface placement');
const retained = surface.geometry.getAttribute('aTattooUv');
const retainedAnchor = surface.anchor;
assert.equal(surface.place({...surface.anchor, faceIndex:999999},mesh.matrixWorld),false);
assert.equal(surface.place({...surface.anchor, bodyMeshId:'different-model'},mesh.matrixWorld),false);
assert.equal(surface.place({...surface.anchor, barycentric:[2,0,0]},mesh.matrixWorld),false);
assert.equal(surface.anchor,retainedAnchor);
assert.equal(surface.geometry.getAttribute('aTattooUv'),retained);
assert.deepEqual(other.geometry.getAttribute('aTattooUv').array,otherUv,'independent homepage previews do not share placements');
assert(source.includes('${SURFACE_TATTOO_GLSL}'));
assert(!source.includes('uDesignCenter'), 'old cylindrical tattoo mapping removed');
assert(source.includes('float aroundLimb = atan(vObjPos.x, vObjPos.z);'), 'decorative wireframe preserved');
surface.dispose(); other.dispose(); material.dispose(); original.dispose();
console.log('PASS: homepage/editor surface mapping, triangle masks, anchors, rejected hits and instance isolation.');

// Exercise the actual window handlers: the final pointer position must survive
// release so a fast click or final drag movement is not lost before rendering.
const gestureStart = source.indexOf('    const onMove = (e: PointerEvent) => {');
const gestureEnd = source.indexOf("    window.addEventListener('pointermove', onMove);", gestureStart);
assert(gestureStart>=0 && gestureEnd>gestureStart);
const gestureCode = ts.transpile(source.slice(gestureStart, gestureEnd), {target:ts.ScriptTarget.ES2022});
class FakePointerEvent {
  constructor(type, x, y, id=1) { this.type=type; this.clientX=x; this.clientY=y; this.pointerId=id; }
}
function gesture(mode) {
  const press={current:{id:1,x:10,y:10,moved:false}}, pointer={current:null};
  const offset={current:0}, lastX={current:10}, interacting={current:true};
  const modeChanges=[];
  const callbacks=new Function('press','pointer','offset','lastX','interacting','dragMode','setDragMode','PointerEvent',`const DRAG_SENSITIVITY=.008;${gestureCode};return {onMove,onEnd}`)(press,pointer,offset,lastX,interacting,mode,m=>modeChanges.push(m),FakePointerEvent);
  return {...callbacks,press,pointer,offset,interacting,modeChanges};
}
const click=gesture('rotate');click.onEnd(new FakePointerEvent('pointerup',10,10));
assert.deepEqual(click.pointer.current,{x:10,y:10},'plain click queues a placement');
const rotate=gesture('rotate');rotate.onMove(new FakePointerEvent('pointermove',30,10));rotate.onEnd(new FakePointerEvent('pointerup',30,10));
assert.equal(rotate.pointer.current,null,'ordinary rotation must not move the tattoo');assert(rotate.offset.current>0);
const drag=gesture('design');drag.onMove(new FakePointerEvent('pointermove',30,15));drag.onEnd(new FakePointerEvent('pointerup',40,20));
assert.deepEqual(drag.pointer.current,{x:40,y:20},'last release coordinate survives for the next frame');
assert.equal(drag.interacting.current,false);assert.deepEqual(drag.modeChanges,[null]);
const cancelled=gesture('design');cancelled.onMove(new FakePointerEvent('pointermove',30,15));cancelled.onEnd(new FakePointerEvent('pointercancel',30,15));assert.equal(cancelled.pointer.current,null);
const secondary=gesture('design');secondary.onMove(new FakePointerEvent('pointermove',100,100,2));secondary.onEnd(new FakePointerEvent('pointerup',100,100,2));assert.equal(secondary.pointer.current,null);assert.equal(secondary.interacting.current,true);
console.log('PASS: click, rotation, modified drag, release, cancellation and secondary pointer behavior.');
