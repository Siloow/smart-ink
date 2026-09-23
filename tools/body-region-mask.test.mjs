/** node tools/body-region-mask.test.mjs: actual model masks and TS/Python parity. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { loadBodyPreview } from './body-shape-visual-loader.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({ stdin: { contents: "export * from './src/render/bodyRegionMask.ts'; export * from './src/render/bodyRegions.ts';", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const { createRegionMasks, regionFrame, classifyPoint, REGION_INDEX } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
// Extract current production Python helpers, not a mirrored test implementation.
const python = `import ast,json,sys
source=open(sys.argv[1]).read()
names={'BODY_REGION_IDS','TORSO_HALF_WIDTH','_torso_half_width','_original_body_region_masks'}
parts=[]
for n in ast.parse(source).body:
 name=n.name if isinstance(n,ast.FunctionDef) else (n.target.id if isinstance(n,ast.AnnAssign) and isinstance(n.target,ast.Name) else (n.targets[0].id if isinstance(n,ast.Assign) and len(n.targets)==1 and isinstance(n.targets[0],ast.Name) else None))
 if name in names: parts.append(ast.get_source_segment(source,n));names.remove(name)
assert not names,names
scope={}
exec('from __future__ import annotations\\n'+'\\n\\n'.join(parts),scope)
json.dump(scope['_original_body_region_masks'](json.load(sys.stdin)),sys.stdout)
`;
let totalPhantomFaces = 0, totalHandVertices = 0;
for (const sex of ['male', 'female']) {
  const { geometry } = await loadBodyPreview(root, sex);
  geometry.computeBoundingBox();
  const box = geometry.boundingBox, bounds = { minX: box.min.x, maxX: box.max.x, minY: box.min.y, maxY: box.max.y };
  const base = geometry.attributes.position.array, preserved = base.slice(), index = geometry.index.array, frame = regionFrame(bounds);
  const masks = createRegionMasks(base, bounds), expanded = geometry.toNonIndexed();
  const expandedMasks = createRegionMasks(expanded.attributes.position.array, bounds);
  const points = Array.from({ length: base.length / 3 }, (_, i) => Array.from(base.subarray(i * 3, i * 3 + 3)));
  const run = spawnSync(process.env.PYTHON ?? 'python3', ['-c', python, `${root}/smartink-live/sceneImporter.py`], { input: JSON.stringify(points), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(run.status, 0, run.stderr);
  const native = JSON.parse(run.stdout);
  const tags = points.map(([x, y]) => REGION_INDEX[classifyPoint(x, y, frame)]);
  let phantomFaces = 0, handVertices = 0;
  for (const [region, values] of Object.entries(masks)) {
    assert.equal(values.length, points.length);
    assert.deepEqual(values, Float32Array.from(native[region]), `${sex} ${region}: exact Float32 Python parity`);
    assert.ok(values.some(v => v > 0) && values.some(v => v < 0), `${sex} ${region}: bounded cutout`);
    for (let i = 0; i < index.length; i++) assert.equal(expandedMasks[region][i], values[index[i]], `${sex} ${region}: duplicate UV seam and expanded geometry consistency`);
    for (const value of values) assert.ok(Number.isFinite(value));
  }
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i], u = (x - frame.centerX) / frame.halfWidth, h = (y - frame.minY) / frame.height;
    if (Math.abs(u) > 0.85 && h < 0.58) {
      const arm = u >= 0 ? 'armLeft' : 'armRight';
      assert.ok(masks[arm][i] > 0, `${sex}: complete distal hand, including low fingertips`);
      assert.ok(masks.head[i] < 0 && masks.torso[i] < 0 && masks.legLeft[i] < 0 && masks.legRight[i] < 0, `${sex}: hand does not appear in another cutout`);
      handVertices++;
    }
    assert.ok(Object.values(masks).some(values => values[i] >= 0), `${sex}: every vertex belongs to a region`);
    assert.ok(Object.values(masks).filter(values => values[i] > 0).length <= 1, `${sex}: region interiors never overlap`);
  }
  for (let f = 0; f < index.length; f += 3) {
    const ids = [index[f], index[f + 1], index[f + 2]], values = ids.map(i => tags[i]);
    // The old shader displays head bands between torso(0) and arm(2/3).
    if (Math.min(...values) === 0 && Math.max(...values) >= 2 && !values.includes(1)) {
      assert.ok(ids.every(i => masks.head[i] < 0), `${sex}: no phantom head fragments on body/limb boundaries`);
      phantomFaces++;
    }
  }
  assert.ok(handVertices > 100 && phantomFaces > 10, `${sex}: real edge-case coverage`);
  assert.deepEqual(base, preserved, `${sex}: masking never changes geometry`);
  totalHandVertices += handVertices; totalPhantomFaces += phantomFaces;
  console.log(`${sex}: six signed cutouts, exact Python parity, ${handVertices} full hand vertices, ${phantomFaces} former phantom-head triangles.`);
  geometry.dispose(); expanded.dispose();
}
// Production render output must use the field on its original mesh, not repeat
// the old post-pose classification or remove vertices from the multires cage.
const importer = fs.readFileSync(`${root}/smartink-live/sceneImporter.py`, 'utf8');
const cut = importer.slice(importer.indexOf('def isolate_body_region('), importer.indexOf('# Eyes and hair'));
assert.match(cut, /'SmartInkFocus', 'FLOAT', 'POINT'/);
assert.doesNotMatch(cut, /bmesh\.ops\.delete/);
assert.match(importer, /original_masks = _original_body_region_masks\(original_coords\)/);
assert.match(importer, /isolate_body_region\(body, contract\.get\("bodyRegion"\), original_masks\)/);
console.log(`Focus regression passed: ${totalPhantomFaces} stray-piece triangles eliminated; ${totalHandVertices} distal hand vertices retained.`);
