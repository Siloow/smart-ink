import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
const bundle = await build({stdin:{contents:"export * from './src/measurements/fitter';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const { solveFit, deformFit } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const references = JSON.parse(await fs.readFile('tools/fixtures/measurement-reference.json', 'utf8'));
const recipes = [];
for (const row of references) {
  const bodyMeshId = row.sex === 'male' ? 'body_full' : 'body_full_female';
  const asset = JSON.parse(gunzipSync(await fs.readFile(`public/measurements/${row.sex}-v1.bin`)));
  const { fit } = solveFit(asset, bodyMeshId, row.values);
  const expected = deformFit(asset, fit);
  const result = spawnSync(process.env.PYTHON ?? 'python3', ['-c', `import json,sys
from server.measurement_fit import validate_fit,load_asset,deform_fit
f=json.load(sys.stdin)
validate_fit(f,f['bodyMeshId'])
print(json.dumps(deform_fit(load_asset(f['bodyMeshId']),f)))`], {input:JSON.stringify(fit),encoding:'utf8',maxBuffer:4*1024*1024});
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  assert.equal(actual.length, expected.length);
  let error = 0;
  for (let i=0;i<actual.length;i++) error = Math.max(error, Math.abs(actual[i]-expected[i]));
  assert.ok(error < 1e-12, `${row.sex}/${row.label}: renderer divergence ${error}`);
  recipes.push({sex:row.sex,label:row.label,fit});
  console.log(`${row.sex}/${row.label}: all ${actual.length/3} renderer vertices match browser (< 1e-12 m)`);
}
if (process.argv.includes('--write-fixtures')) await fs.writeFile('tools/fixtures/body-fit-recipes.json',JSON.stringify(recipes,null,2)+'\n');
else {
  // V8/libm may differ by a final bit across CPU architectures. Keep a strict
  // absolute tolerance, far below any meaningful fit or measurement change.
  const compare = (actual, expected, path = 'recipes') => {
    if (typeof actual === 'number' && typeof expected === 'number') {
      assert.ok(Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 1e-12,
        `${path}: regenerate fit recipes when the browser solver changes (${actual} vs ${expected})`);
    } else if (actual && expected && typeof actual === 'object' && typeof expected === 'object') {
      assert.equal(Array.isArray(actual), Array.isArray(expected), path);
      assert.deepEqual(Object.keys(actual), Object.keys(expected), path);
      for (const key of Object.keys(actual)) compare(actual[key], expected[key], `${path}.${key}`);
    } else assert.deepEqual(actual, expected, path);
  };
  compare({ parameters: [.12343967471175452] }, { parameters: [.1234396747117545] });
  assert.throws(() => compare({ parameters: [.1] }, { parameters: [.10000001] }));
  assert.throws(() => compare({ label: 'male' }, { label: 'female' }));
  compare(JSON.parse(await fs.readFile('tools/fixtures/body-fit-recipes.json','utf8')), recipes);
}
