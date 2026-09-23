/** Actual preview/native studio profile, settings, and emitter parameter parity. */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../', import.meta.url));
const bundled = await build({ stdin: { contents: "export * from './src/render/studioGeometry.ts';export * from './src/render/studioLighting.ts';export * from './src/render/studioLightRig.ts';export * from './src/render/studioSettings.ts';", resolveDir: root, loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', write: false });
const preview = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const shapes = [[.05, .05], [.5, 2], [2, 4], [4.2, 8], [5.2, 25], [8, 40]];
const lights = ['directional', 'area', 'point', 'spot'].flatMap(type => [undefined, 0, .45, 1].map(softness => ({ type, position: [3, 4, 5], target: [.2, 1, -.5], intensity: .7, color: '#ffffff', softness })))
  .concat([{ type: 'area', position: [0, 2, 6], target: [0, 0, 0], intensity: 1, color: '#ffffff', blenderAreaSize: [1, 3] }]);
lights.push(...['directional', 'spot', 'point'].map(type => ({ type, position: [0, 0, 0], target: [0, 0, 0], intensity: .7, softness: 0, color: '#ffffff' })));
const settings = [{}, { mode: 'sweep' }, { mode: 'plain', color: '#AAbbCC', shadow: 0, showGuides: true }, { mode: 'sweep', color: '#30343c', shadow: 1, showGuides: false }];
const python = `import ast,json,math,sys
s=open(sys.argv[1]).read();names={'STUDIO_DEFAULTS','_studio_settings','_cyclorama_profile','_studio_light_parameters'};parts=[]
for n in ast.parse(s).body:
 name=n.name if isinstance(n,ast.FunctionDef) else (n.targets[0].id if isinstance(n,ast.Assign) and isinstance(n.targets[0],ast.Name) else None)
 if name in names:parts.append(ast.get_source_segment(s,n));names.remove(name)
assert not names,names
scope={'math':math};exec('\\n\\n'.join(parts),scope);q=json.load(sys.stdin)
json.dump({'profiles':[scope['_cyclorama_profile'](*v) for v in q['shapes']],'lights':[scope['_studio_light_parameters'](v,1.2) for v in q['lights']],'settings':[scope['_studio_settings']({'studio':v}) for v in q['settings']]},sys.stdout)
`;
const run = spawnSync(process.env.PYTHON ?? 'python3', ['-c', python, `${root}/smartink-live/sceneImporter.py`], { input: JSON.stringify({ shapes, lights, settings }), encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
assert.equal(run.status, 0, run.stderr);
const native = JSON.parse(run.stdout);
for (let i = 0; i < shapes.length; i++) {
  const geometry = preview.createStudioSweepGeometry(...shapes[i]);
  const [profile, halfWidth] = native.profiles[i], p = geometry.attributes.position;
  assert.equal(p.count, profile.length * 2);
  for (let row = 0; row < profile.length; row++) {
    assert.equal(p.getX(row * 2), Math.fround(-halfWidth));
    assert.equal(p.getY(row * 2), Math.fround(profile[row][1]));
    assert.equal(p.getZ(row * 2), Math.fround(-profile[row][0]));
  }
  geometry.dispose();
}
for (let i = 0; i < lights.length; i++) {
  const light = lights[i], result = native.lights[i], softness = preview.lightSoftness(light);
  const diameter = preview.softboxSize(softness), sample = preview.resolveStudioLightRig([light], 1.2).samples[0], distance2 = sample.distanceScale;
  assert.deepEqual(result.target, sample.target.toArray());
  assert.equal(result.width, light.blenderAreaSize?.[0] ?? diameter);
  assert.equal(result.height, light.blenderAreaSize?.[1] ?? diameter);
  assert.equal(result.radius, softness === 0 ? 0 : diameter / 2);
  assert.equal(result.energy, light.intensity * 1.2 * distance2 * Math.PI ** 2 * (['area', 'directional'].includes(light.type) ? 1 : 4));
}
assert.deepEqual(native.settings, settings.map(preview.normalizeStudio));
console.log(`Studio parity passed: ${shapes.length} actual sweep geometries, ${lights.length} emitter settings, ${settings.length} normalized contracts.`);
