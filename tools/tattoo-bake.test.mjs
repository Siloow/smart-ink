/** Run with: node tools/tattoo-bake.test.mjs (no browser or network required). */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const renderDir = fileURLToPath(new URL('../src/render/', import.meta.url));
const source = await fs.readFile(new URL('../src/render/bakeInkLayer.ts', import.meta.url), 'utf8');
// Bundle the production implementation, exposing its padding helper only in
// this in-memory test module. Production public exports stay unchanged.
const { outputFiles } = await build({
  stdin: {
    contents: `${source}\nexport { padIslandEdges, loadTexture, THREE };`,
    loader: 'ts',
    resolveDir: renderDir,
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { padIslandEdges, loadTexture, bakeInkLayer, THREE } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
);

const size = 20;
const pixels = new Uint8Array(size * size * 4);
const coverage = new Uint8Array(pixels.length);
const index = (x, y) => (y * size + x) * 4;
for (let y = 5; y < 15; y++) {
  for (let x = 5; x < 15; x++) coverage[index(x, y)] = 255;
}
pixels.set([192, 96, 48, 128], index(5, 10));
coverage[index(3, 10)] = 255;
padIslandEdges(pixels, coverage, size);
assert.deepEqual(
  [...pixels.subarray(index(4, 10), index(4, 10) + 4)],
  [192, 96, 48, 128],
  'edge margin must preserve straight RGBA',
);
assert.equal(pixels[index(6, 10) + 3], 0, 'padding must not thicken strokes inside an island');
assert.equal(pixels[index(3, 10) + 3], 0, 'padding must not paint another occupied island');
assert.equal(pixels[index(2, 9) + 3], 128, 'margin extends three texels');
assert.equal(pixels[index(1, 9) + 3], 0, 'margin stops after three texels');
assert.equal(pixels[index(19, 10) + 3], 0, 'padding must not wrap the atlas');
const empty = new Uint8Array(pixels.length);
padIslandEdges(empty, coverage, size);
assert.ok(empty.every((value) => value === 0), 'empty export remains empty');
await assert.rejects(() => bakeInkLayer({ tattooImage: 'unused', size: 0 }), /resolution/);
await assert.rejects(() => bakeInkLayer({ tattooImage: 'unused' }), /Place a tattoo/);
const alreadyAborted = new AbortController(); alreadyAborted.abort();
await assert.rejects(() => bakeInkLayer({ tattooImage: 'unused', signal: alreadyAborted.signal }), { name: 'AbortError' });

// An asynchronous image failure exercises the real export lifecycle before a
// WebGL context is created. Dragging must not mutate an in-progress snapshot.
const previousDocument = globalThis.document;
const events = {};
globalThis.document = {
  createElementNS() {
    return {
      addEventListener(name, callback) { events[name] = callback; },
      removeEventListener() {},
      set src(value) { this.currentSrc = value; },
    };
  },
};
try {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geometry.setAttribute('aTattooUv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geometry.setAttribute('aTattooMask', new THREE.Float32BufferAttribute([1, 1, 1], 1));
  let snapshot;
  let disposed = false;
  let originalDisposed = false;
  geometry.addEventListener('dispose', () => { originalDisposed = true; });
  const clone = geometry.clone.bind(geometry);
  geometry.clone = () => {
    snapshot = clone();
    snapshot.addEventListener('dispose', () => { disposed = true; });
    return snapshot;
  };
  const baking = bakeInkLayer({
    tattooImage: 'test.png',
    surface: { geometry, size: 1, aspect: 1, color: '#fff', opacity: 1 },
  });
  assert.ok(snapshot, 'geometry must be cloned before waiting for source image');
  geometry.getAttribute('aTattooUv').setX(0, 42);
  assert.equal(snapshot.getAttribute('aTattooUv').getX(0), 0, 'snapshot must not alias live attributes');
  events.error({ type: 'error' });
  await assert.rejects(baking);
  assert.equal(disposed, true, 'image-load failure must dispose snapshot');
  assert.equal(originalDisposed, false, 'export must preserve live body geometry');
  for (const mode of ['abort', 'timeout']) {
    disposed = false;
    const controller = new AbortController();
    const pending = bakeInkLayer({ tattooImage: `${mode}.png`, signal: controller.signal,
      textureTimeoutMs: mode === 'timeout' ? 5 : 1000,
      surface: { geometry, size: 1, aspect: 1, color: '#fff', opacity: 1 } });
    if (mode === 'abort') controller.abort();
    await assert.rejects(pending, mode === 'abort' ? { name: 'AbortError' } : /too long/);
    assert.equal(disposed, true, `${mode} immediately disposes the owned geometry`);
    assert.equal(originalDisposed, false, `${mode} preserves live geometry`);
    // A late network image must not start WebGL work or resurrect this export.
    events.load.call({});
  }
  const disposeTexture = THREE.Texture.prototype.dispose;
  const textureDisposals = [];
  THREE.Texture.prototype.dispose = function () { textureDisposals.push(this); return disposeTexture.call(this); };
  try {
    const controller = new AbortController();
    const loading = loadTexture('late-image.png', controller.signal);
    controller.abort(); await assert.rejects(loading, { name: 'AbortError' });
    assert.equal(textureDisposals.length, 1, 'pending texture released on cancel');
    events.load.call({});
    assert.equal(textureDisposals.length, 1, 'late image callback cannot double-dispose or retain the texture');
  } finally { THREE.Texture.prototype.dispose = disposeTexture; }
  geometry.dispose();
} finally {
  if (previousDocument === undefined) delete globalThis.document;
  else globalThis.document = previousDocument;
}
console.log('Tattoo bake checks passed: atlas padding, alpha, input validation, snapshot isolation, image timeout/cancellation, late callbacks and failure cleanup.');
