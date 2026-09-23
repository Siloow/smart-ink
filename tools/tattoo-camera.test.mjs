/** Actual GLB chart/shape/pose geometry plus exact production Model handle callbacks. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, transform } from 'esbuild';
import ts from 'typescript';
import * as THREE from 'three';
import { loadBodyPreview } from './body-shape-visual-loader.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const built = await build({ stdin: { contents: `export * from './src/render/tattooCamera'; export * from './src/render/tattooSource'; export * from './src/render/surfacePlacement'; export * as shape from './src/render/bodyShape'; export * as pose from './src/render/bodyPose';`, resolveDir: root }, bundle: true, format: 'esm', platform: 'node', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const { tattooFramingFromGeometry: framing, frameTattoo: cameraView, normalizeTattooCamera, TATTOO_CAMERA_LIMITS } = api;
const anchor = (faceIndex, barycentric = [1 / 3, 1 / 3, 1 / 3]) => ({ faceIndex, barycentric, bodyMeshId: 'test' });
const identity = new THREE.Matrix4();
assert.deepEqual(normalizeTattooCamera(), { azimuth: 0, elevation: 0, zoom: 1 });
assert.deepEqual(normalizeTattooCamera({ azimuth: Infinity, elevation: NaN, zoom: -3 }), { azimuth: 0, elevation: 0, zoom: .65 });
assert.deepEqual(normalizeTattooCamera({ azimuth: 300, elevation: -300, zoom: 20 }), { azimuth: 55, elevation: -40, zoom: 1.8 });
function addMasks(geometry) {
  const count = geometry.attributes.position.count;
  for (const [name, fill] of [['aTattooMask', 1], ['aFocusMask', 1], ['aClothingMask', -1]]) geometry.setAttribute(name, new THREE.Float32BufferAttribute(new Float32Array(count).fill(fill), 1));
}
function indices(geometry, face) { return [0, 1, 2].map(k => geometry.index ? geometry.index.getX(face * 3 + k) : face * 3 + k); }
function atAnchor(geometry, matrix, saved) {
  return indices(geometry, saved.faceIndex).reduce((p, i, k) => p.addScaledVector(new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, i), saved.barycentric[k]), new THREE.Vector3()).applyMatrix4(matrix);
}
function checkView(f, adjustment, aspect, label) {
  const view = cameraView(f, adjustment, aspect), camera = new THREE.PerspectiveCamera(view.fov, aspect, .1, 100);
  camera.position.fromArray(view.position); camera.lookAt(...view.target); camera.updateMatrixWorld(true);
  assert.deepEqual(view.target, f.center, `${label}: anchor is the target, never the footprint bounding centre`);
  const offset = camera.position.clone().sub(new THREE.Vector3(...f.center)), direction = offset.clone().normalize();
  assert.ok(view.position.every(Number.isFinite), `${label}: finite camera`);
  assert.ok(direction.dot(new THREE.Vector3(...f.normal)) > .43, `${label}: stays in the outward hemisphere`);
  assert.ok(offset.length() >= f.minDistance, `${label}: minimum skin clearance`);
  if ((adjustment.zoom ?? 1) <= 1) for (let i = 0; i < f.points.length; i += 3) {
    const point = new THREE.Vector3().fromArray(f.points, i).project(camera);
    assert.ok(Math.abs(point.x) <= 1 + 1e-5 && Math.abs(point.y) <= 1 + 1e-5, `${label}: unzoomed tattoo fits both viewport axes`);
    assert.ok(point.z < 1 && point.z > -1, `${label}: visible depth range`);
  }
  return view;
}

// Exact clipping matters for small tattoos that fit completely inside a body
// triangle: keeping only existing geometry vertices would produce no frame.
for (const deindex of [false, true]) {
  let geometry = new THREE.PlaneGeometry(4, 4, 1, 1); if (deindex) geometry = geometry.toNonIndexed();
  addMasks(geometry); const pos = geometry.attributes.position;
  geometry.setAttribute('aTattooUv', new THREE.Float32BufferAttribute(Array.from({ length: pos.count * 2 }, (_, i) => i % 2 ? pos.getY(Math.floor(i / 2)) : pos.getX(Math.floor(i / 2))), 2));
  const ids = indices(geometry, 0), saved = anchor(0, new THREE.Triangle(...ids.map(i => new THREE.Vector3().fromBufferAttribute(pos, i))).getBarycoord(new THREE.Vector3(), new THREE.Vector3()).toArray());
  for (const size of [.042, .42, 1.26]) for (const aspect of [1 / 3, 1, 3]) for (const angle of [0, Math.PI / 4, Math.PI / 2, Math.PI]) {
    const f = framing(geometry, identity, saved, { size, aspect, rotationRad: angle }); assert.ok(f, 'subtriangle footprint is found');
    const expectedRadius = size * Math.hypot(Math.min(aspect, 1), Math.min(1 / aspect, 1)) / 2;
    assert.ok(Math.abs(f.radius - expectedRadius) < 1e-6, 'rotated rectangle has exact physical radius');
    for (const viewport of [.4, 1, 2]) checkView(f, {}, viewport, 'analytic plane');
  }
  geometry.attributes.aFocusMask.array.set(Array.from({ length: pos.count }, (_, i) => pos.getX(i) + .1));
  geometry.attributes.aClothingMask.array.set(Array.from({ length: pos.count }, (_, i) => pos.getY(i) - .1));
  const clipped = framing(geometry, identity, saved, { size: 1, aspect: 1, rotationRad: .2 }); assert.ok(clipped);
  for (let i = 0; i < clipped.points.length; i += 3) { assert.ok(clipped.points[i] >= -.100001); assert.ok(clipped.points[i + 1] <= .100001); }
  const hairCoverage = new Float32Array(pos.count);
  assert.ok(framing(geometry, identity, saved, { size: 1, aspect: 1, rotationRad: 0, hairCoverage }), 'zero hair coverage leaves bare skin frameable');
  hairCoverage.fill(1); assert.equal(framing(geometry, identity, saved, { size: 1, aspect: 1, rotationRad: 0, hairCoverage }), null, 'actual 0..1 hair mask blocks a covered anchor');
  hairCoverage.set(Array.from({ length: pos.count }, (_, i) => .4 + pos.getX(i)));
  const hairEdge = framing(geometry, identity, saved, { size: 1, aspect: 1, rotationRad: 0, hairCoverage }); assert.ok(hairEdge);
  for (let i = 0; i < hairEdge.points.length; i += 3) assert.ok(hairEdge.points[i] <= .100001, 'hair edge clips at coverage .5');
  geometry.attributes.aClothingMask.array.fill(1); assert.equal(framing(geometry, identity, saved, { size: 1, aspect: 1, rotationRad: 0 }), null, 'covered anchor never masquerades as visible ink');
  geometry.attributes.aClothingMask.array.fill(-1); geometry.attributes.aTattooMask.array.fill(0);
  assert.equal(framing(geometry, identity, saved, { size: 1, aspect: 1, rotationRad: 0 }), null, 'rejected chart faces stay rejected');
  assert.equal(framing(geometry, identity, anchor(9000), { size: 1, aspect: 1, rotationRad: 0 }), null, 'malformed anchors are rejected'); geometry.dispose();
}
// A nearby second body surface must stop zoom before putting the camera inside it.
{
  const f = { center: [0, 0, 0], normal: [0, 0, 1], up: [0, 1, 0], points: new Float32Array([-.1, -.1, 0, .1, -.1, 0, 0, .1, 0]), radius: .15, minDistance: .18,
    bodyTriangles: new Float32Array([-2, -2, .7, 2, -2, .7, 0, 2, .7]) };
  assert.ok(cameraView(f, { zoom: 1.8 }).position[2] >= .879999, 'second skin sheet imposes camera clearance');
  for (const normal of [[0, 1, 0], [0, -1, 0]]) checkView({ ...f, bodyTriangles: undefined, normal, up: [0, 0, -1] }, {}, 1, 'pole');
}

for (const withPoints of [true, false]) for (const direction of [[0, 0, 1], [1, .2, -.3], [0, 1, 0], [0, 0, 0]]) {
  const region = { center: [.2, -.3, .1], radius: 2, ...(withPoints ? { points: new Float32Array([.2, 1.7, .1, .2, -2.3, .1, -1.8, -.3, .1, 2.2, -.3, .1]) } : {}) };
  const f = api.regionSnapshotFraming(region, direction); assert.deepEqual(f.center, region.center);
  for (const adjustment of [{}, { zoom: 1.8 }, { azimuth: 55, elevation: -40 }]) {
    const view = checkView(f, adjustment, .5, 'body fallback');
    assert.ok(new THREE.Vector3(...view.position).distanceTo(new THREE.Vector3(...f.center)) >= region.radius + .179999, 'fallback camera stays outside body bound even at maximum zoom');
  }
  if (withPoints) { region.points[0] = 999; assert.notEqual(f.points[0], 999, 'fallback owns a frozen point snapshot'); }
}

const timings = [], views = []; let tested = 0;
const visual = process.argv.includes('--visual'), output = path.join(root, 'reports', 'tattoo-camera');
if (visual) await fs.mkdir(output, { recursive: true });
const logoBytes = await fs.readFile(path.join(root, 'public/logo.png')), logoAspect = logoBytes.readUInt32BE(16) / logoBytes.readUInt32BE(20);
for (const sex of ['male', 'female']) {
  const { geometry: source, matrix: rawMatrix } = await loadBodyPreview(root, sex), geometry = source.toNonIndexed(); source.dispose();
  const neutralWorld = geometry.clone().applyMatrix4(rawMatrix); neutralWorld.computeBoundingBox();
  const origin = neutralWorld.boundingBox.getCenter(new THREE.Vector3()); neutralWorld.dispose();
  const matrix = rawMatrix.clone().premultiply(new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z));
  const reference = geometry.clone(), topology = api.createSurfaceTopology(reference), prepared = api.shape.prepareDeformable(geometry), bounds = api.shape.shapeBounds([prepared]);
  addMasks(geometry);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })); mesh.matrixAutoUpdate = false; mesh.matrix.copy(matrix); mesh.updateMatrixWorld(true);
  const cases = [
    { id: 'chest-seam', origin: [0, 1.06, 3], direction: [0, 0, -1] },
    { id: 'back', origin: [.15, 1.05, -3], direction: [0, 0, 1] },
    { id: 'forearm', origin: [sex === 'male' ? .81 : .70, .40, 3], direction: [0, 0, -1] },
    { id: 'shoulder', origin: [5, 1.071, 0], direction: [-1, 0, 0] },
    { id: 'calf', origin: [sex === 'male' ? .39 : .31, -1.45, -3], direction: [0, 0, 1] },
  ];
  const deformations = [
    { id: 'neutral', shape: {}, pose: {} },
    { id: 'slim-flex', shape: { build: -1, shoulders: -1, arms: -.8 }, pose: api.pose.poseFromPreset('flex') },
    { id: 'heavy-step', shape: { build: 1, shoulders: 1, arms: 1, legs: 1 }, pose: api.pose.poseFromPreset('step') },
  ];
  for (const placement of cases) {
    api.shape.applyBodyShape([prepared], bounds, api.shape.normalizeShape()); mesh.matrix.copy(matrix); mesh.updateMatrixWorld(true);
    const hit = new THREE.Raycaster(new THREE.Vector3(...placement.origin), new THREE.Vector3(...placement.direction)).intersectObject(mesh)[0];
    assert.ok(hit, `${sex} ${placement.id}: named anatomical ray must hit`);
    const vertices = [hit.face.a, hit.face.b, hit.face.c].map(i => new THREE.Vector3().fromBufferAttribute(geometry.attributes.position, i).applyMatrix4(matrix));
    const saved = { ...anchor(hit.faceIndex, new THREE.Triangle(...vertices).getBarycoord(hit.point, new THREE.Vector3()).toArray()), bodyMeshId: `body_${sex}` };
    const chart = api.buildSurfaceChart(topology, reference, matrix, saved); assert.ok(chart, `${sex} ${placement.id}: chart must exist`);
    geometry.setAttribute('aTattooUv', new THREE.BufferAttribute(chart.uv, 2));
    const mask = chart.mask.slice(); for (let face = 0; face < chart.faceMask.length; face++) if (!chart.faceMask[face]) mask.fill(0, face * 3, face * 3 + 3);
    geometry.setAttribute('aTattooMask', new THREE.BufferAttribute(mask, 1));
    for (const deformation of deformations) {
      api.shape.applyBodyShape([prepared], bounds, api.shape.normalizeShape(deformation.shape)); api.pose.applyBodyPose([prepared], bounds, api.pose.normalizePose(deformation.pose));
      const posedWorld = geometry.clone().applyMatrix4(matrix); posedWorld.computeBoundingBox(); const movedCenter = posedWorld.boundingBox.getCenter(new THREE.Vector3()); posedWorld.dispose();
      const posedMatrix = matrix.clone().premultiply(new THREE.Matrix4().makeTranslation(-movedCenter.x, -movedCenter.y, -movedCenter.z));
      const size = placement.id === 'chest-seam' ? .6 : .35, imageAspect = placement.id === 'forearm' ? 1 / 3 : 1.5, rotationRad = placement.id === 'calf' ? Math.PI / 4 : .2;
      const started = performance.now(), f = framing(geometry, posedMatrix, saved, { size, aspect: imageAspect, rotationRad }); timings.push(performance.now() - started);
      const label = `${sex}-${placement.id}-${deformation.id}`; assert.ok(f, `${label}: valid framing`);
      assert.ok(new THREE.Vector3(...f.center).distanceTo(atAnchor(geometry, posedMatrix, saved)) < 1e-6, `${label}: follows the same barycentric anchor`);
      const expectedNormal = indices(geometry, saved.faceIndex).reduce((n, i, k) => n.addScaledVector(new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal, i), saved.barycentric[k]), new THREE.Vector3()).applyMatrix3(new THREE.Matrix3().getNormalMatrix(posedMatrix)).normalize();
      assert.ok(expectedNormal.dot(new THREE.Vector3(...f.normal)) > .999999, `${label}: uses current posed normal`);
      const adjustments = [{}, { zoom: .65 }, { zoom: 1.8 }, { azimuth: -55 }, { azimuth: 55 }, { elevation: -40 }, { elevation: 40 }, { azimuth: -55, elevation: -40 }, { azimuth: 55, elevation: 40 }];
      for (const adjustment of adjustments) for (const viewport of [.5, 1.8]) { checkView(f, adjustment, viewport, label); tested++; }
      if (visual && ((placement.id === 'chest-seam' && deformation.id === 'neutral') || (placement.id === 'forearm' && deformation.id === 'slim-flex'))) {
        const normals = geometry.attributes.normal.array, transformed = new Float32Array(normals.length), normalMatrix = new THREE.Matrix3().getNormalMatrix(posedMatrix), v = new THREE.Vector3();
        for (let i = 0; i < normals.length; i += 3) v.fromArray(normals, i).applyMatrix3(normalMatrix).normalize().toArray(transformed, i);
        const visualFrame = framing(geometry, posedMatrix, saved, { size, aspect: logoAspect, rotationRad });
        await fs.writeFile(path.join(output, `${label}.json`), JSON.stringify({ positions: Array.from(f.bodyTriangles), normals: Array.from(transformed), uv: Array.from(chart.uv), mask: Array.from(mask), size, aspect: logoAspect, rotationRad }));
        for (const [name, adjustment] of [['default', {}], ['angle', { azimuth: 30, elevation: 15 }], ['close', { zoom: 1.5 }]]) views.push({ id: `${label}-${name}`, geometry: `${label}.json`, camera: cameraView(visualFrame, adjustment, 1.25), aspect: 1.25 });
      }
    }
  }
  geometry.dispose(); reference.dispose(); mesh.material.dispose();
}
if (visual) await fs.writeFile(path.join(output, 'views.json'), JSON.stringify(views, null, 2));

// The production Model handle must report the displayed example as ready even
// when uploadedImage is null; hidden/unloaded/covered designs do not supply a frame.
const modelSource = await fs.readFile(path.join(root, 'src/ModelWithUVTattoo.tsx'), 'utf8');
const ast = ts.createSourceFile('Model.tsx', modelSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handle;
function findHandle(node) { if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useImperativeHandle') handle = node.arguments[1].getText(ast); ts.forEachChild(node, findHandle); }
findHandle(ast); assert.ok(handle);
const code = (await transform(`(${handle})()`, { loader: 'ts' })).code;
const expectedFrame = { center: [1, 2, 3] }, framedArgs = [];
const scope = { placeInView: () => false, resolveTattooSource: api.resolveTattooSource, tattooFramingFromGeometry: (...args) => { framedArgs.push(args); return expectedFrame; }, uploadedImage: null, loadedImageRef: { current: '/logo.png' }, hasPlacedRef: { current: true }, visible: true,
  bodyMeshRef: { current: { geometry: {}, matrixWorld: identity, updateWorldMatrix() {} } }, anchorRef: { current: anchor(0) }, chartRef: { current: {} }, hairCoverageRef: { current: null },
  size: .42, imageAspect: 2, rotationRad: .3, decalColor: '#223344', decalOpacity: .6, regionFraming: () => null, isolateRegion: null };
const getHandle = () => new Function('scope', `with(scope) { return ${code} }`)(scope);
assert.equal(getHandle().getPlacement().imageReady, true); assert.equal(getHandle().getPlacement().imageSource, '/logo.png'); assert.equal(getHandle().getPlacement().hasPlaced, true);
assert.equal(getHandle().getTattooFraming(), expectedFrame); assert.equal(framedArgs[0][2], scope.anchorRef.current);
assert.deepEqual(framedArgs[0][3], { size: .42, aspect: 2, rotationRad: .3, hairCoverage: null });
for (const change of [{ uploadedImage: '/new-image.png' }]) {
  const saved = { ...scope }; Object.assign(scope, change); assert.equal(getHandle().getTattooFraming(), null); assert.equal(getHandle().getPlacement().imageReady, false); Object.assign(scope, saved);
}
scope.visible = false; scope.decalOpacity = 0; assert.equal(getHandle().getTattooFraming(), expectedFrame, 'Show before retains the exact tattoo framing');
scope.uploadedImage = scope.loadedImageRef.current = '/custom.png'; assert.equal(getHandle().getPlacement().imageSource, '/custom.png'); assert.equal(getHandle().getTattooFraming(), expectedFrame);
assert.equal(Object.keys(TATTOO_CAMERA_LIMITS).length, 3);
timings.sort((a, b) => a - b);
console.log(`Tattoo camera passed: ${tested} real-body camera cases, exact seam/rotation/aspect clipping, posed anchors/normals, camera clearance, tiny triangles, hidden/covered ink and production example-source handle. Framing median ${timings[Math.floor(timings.length / 2)].toFixed(1)} ms.`);
