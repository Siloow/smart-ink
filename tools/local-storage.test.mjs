/** Real local stores bundled against controlled browser storage adapters. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const sceneKey = 'scenes', historyKey = 'render-history-manifest';
const bundles = new Map();
let fixtureNumber = 0;

async function loadStore(relative, fixture) {
  if (!bundles.has(relative)) {
    const result = await build({
      entryPoints: [fileURLToPath(new URL(relative, import.meta.url))], bundle: true,
      write: false, format: 'esm', platform: 'node', logLevel: 'silent',
      plugins: [{ name: 'controlled-indexeddb', setup(builder) {
        builder.onResolve({ filter: /^idb-keyval$/ }, () => ({ path: 'idb-keyval', namespace: 'test' }));
        builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `
          export const get=(...args)=>globalThis.__smartInkStorageTest.get(...args);
          export const set=(...args)=>globalThis.__smartInkStorageTest.set(...args);
          export const del=(...args)=>globalThis.__smartInkStorageTest.del(...args);` }));
      } }],
    });
    bundles.set(relative, result.outputFiles[0].text);
  }
  globalThis.localStorage = fixture.localStorage;
  globalThis.__smartInkStorageTest = fixture.idb;
  return import(`data:text/javascript;base64,${Buffer.from(`${bundles.get(relative)}\n// fixture ${++fixtureNumber}`).toString('base64')}`);
}

function storageFixture() {
  const raw = new Map(), images = new Map(), operations = [];
  let readError = null, writeError = null, idbFailure = null, paused = null;
  const operation = async (kind, key, value) => {
    operations.push({ kind, key, value });
    if (idbFailure?.kind === kind) {
      const { message, once } = idbFailure;
      if (once) idbFailure = null;
      throw new Error(message);
    }
    if (paused?.kind === kind && paused.match(key)) {
      const wait = paused; paused = null; wait.started = true; await wait.promise;
    }
    if (kind === 'get') return images.get(key);
    if (kind === 'set') images.set(key, value);
    if (kind === 'del') images.delete(key);
  };
  return {
    raw, images, operations,
    localStorage: {
      getItem(key) { if (readError) throw new Error(readError); return raw.get(key) ?? null; },
      setItem(key, value) { operations.push({ kind: 'manifest', key }); if (writeError) throw new Error(writeError); raw.set(key, value); },
      removeItem(key) { raw.delete(key); },
    },
    idb: { get: (key) => operation('get', key), set: (key, value) => operation('set', key, value), del: (key) => operation('del', key) },
    failReads(message) { readError = message; },
    failWrites(message) { writeError = message; },
    failIdb(kind, message, once = false) { idbFailure = message ? { kind, message, once } : null; },
    pauseNext(kind, match = () => true) {
      let release;
      const pause = { kind, match, started: false, promise: new Promise((resolve) => { release = resolve; }), release: () => release() };
      paused = pause; return pause;
    },
  };
}

function scene(id, name = id) {
  return { id, name, bodyMeshId: 'body_full', decalImage: `data:image/png;base64,${id}`, thumbnail: null,
    model: 'FinalBaseMesh', decalScale: 0.42, decalRotation: 0, decalColor: '#ffffff', decalOpacity: 1, decalVisible: false,
    decalPosition: null, decalNormal: null, lightingPreset: 'studio', background: 'white',
    camera: { position: [6, 4, 6], target: [0, 0, 0], fov: 45 }, createdAt: new Date(0), updatedAt: new Date(0), createdBy: 'demo' };
}
function seedScenes(fixture, scenes) {
  fixture.raw.set(sceneKey, JSON.stringify(scenes.map(({ decalImage, thumbnail, ...rest }) => {
    if (decalImage) fixture.images.set(`decal:${rest.id}`, decalImage);
    if (thumbnail) fixture.images.set(`thumb:${rest.id}`, thumbnail);
    return rest;
  })));
}
function seedHistory(fixture, count) {
  const entries = Array.from({ length: count }, (_, index) => ({ id: `old-${index}`, createdAt: count - index, source: 'canvas', width: 10, height: 10 }));
  fixture.raw.set(historyKey, JSON.stringify(entries));
  for (const entry of entries) fixture.images.set(`render-image:${entry.id}`, new Blob([entry.id]));
}
const meta = { source: 'canvas', width: 10, height: 10 };
const image = new Blob(['image'], { type: 'image/png' });

// Only a missing manifest represents an empty collection. Broken JSON,
// unavailable localStorage, and failed image reads cannot erase existing data.
{
  const fixture = storageFixture();
  const { localSceneStore: store } = await loadStore('../src/storage/localSceneStore.ts', fixture);
  assert.deepEqual(await store.loadScenes(), []);
  for (const malformed of ['{broken', '{}', '']) {
    fixture.raw.set(sceneKey, malformed); fixture.operations.length = 0;
    await assert.rejects(store.loadScenes());
    await assert.rejects(store.updateScene(scene('a')));
    assert.equal(fixture.raw.get(sceneKey), malformed);
    assert.equal(fixture.operations.length, 0, 'failed metadata read never starts image or manifest writes');
  }
  seedScenes(fixture, [scene('a'), scene('b')]);
  const original = fixture.raw.get(sceneKey);
  fixture.failReads('Storage unavailable');
  await assert.rejects(store.updateScene(scene('a', 'changed')), /Storage unavailable/);
  assert.equal(fixture.raw.get(sceneKey), original);
  fixture.failReads(null); fixture.operations.length = 0;
  fixture.failIdb('get', 'IndexedDB unavailable');
  await assert.rejects(store.updateScene(scene('a', 'changed')), /IndexedDB unavailable/);
  assert.equal(fixture.raw.get(sceneKey), original);
  assert.ok(fixture.operations.every((operation) => operation.kind === 'get'));
  fixture.failIdb('get', null);
  await assert.rejects(store.updateScene(scene('missing')), /could not be found/);
  assert.equal(fixture.raw.get(sceneKey), original, 'unknown update never silently succeeds');
  await store.updateScene(scene('a', 'Recovered'));
  assert.equal((await store.getScene('a')).name, 'Recovered', 'a rejected mutation does not poison later saves');
  assert.equal((await store.getScene('b')).decalImage, scene('b').decalImage);
}

// Concurrent dashboard/editor mutations share one collection lock. Force an
// image write to yield where two read-modify-write operations previously raced.
{
  const fixture = storageFixture(); seedScenes(fixture, [scene('a'), scene('b')]);
  const { localSceneStore: store } = await loadStore('../src/storage/localSceneStore.ts', fixture);
  const pause = fixture.pauseNext('set', (key) => key === 'decal:a');
  const first = store.updateScene(scene('a', 'A edited'));
  await tick(); assert.equal(pause.started, true);
  const writesBefore = fixture.operations.length;
  const second = store.updateScene(scene('b', 'B edited'));
  const third = store.addScene(scene('c'));
  const fourth = store.deleteScene('a');
  await tick(); assert.equal(fixture.operations.length, writesBefore, 'queued mutations cannot begin reading an old collection');
  pause.release(); await Promise.all([first, second, third, fourth]);
  const scenes = await store.loadScenes();
  assert.deepEqual(scenes.map((entry) => [entry.id, entry.name]), [['b', 'B edited'], ['c', 'c']]);
  assert.equal(fixture.images.has('decal:a'), false);
  assert.equal(fixture.images.get('decal:b'), scene('b').decalImage);
}

// Legacy inline image fields migrate intact while customized lights survive.
{
  const fixture = storageFixture(), legacy = scene('legacy');
  legacy.bodyMeshId = 'forearm'; legacy.lights = [{ type: 'point', intensity: 5 }];
  fixture.raw.set(sceneKey, JSON.stringify([legacy]));
  const { localSceneStore: store } = await loadStore('../src/storage/localSceneStore.ts', fixture);
  assert.equal((await store.getScene('legacy')).bodyMeshId, 'body_full');
  await store.addScene(scene('new'));
  assert.equal(fixture.images.get('decal:legacy'), legacy.decalImage);
  assert.deepEqual((await store.getScene('legacy')).lights, legacy.lights);
}

// At the 40-image limit, eviction yields within the mutation. Both overlapping
// exports must survive, with the two oldest entries removed.
{
  const fixture = storageFixture(); seedHistory(fixture, 40);
  const { localRenderHistory: store } = await loadStore('../src/storage/localRenderHistory.ts', fixture);
  const pause = fixture.pauseNext('del', (key) => key === 'render-image:old-39');
  const first = store.add({ ...meta, sceneName: 'First export' }, image);
  await tick(); assert.equal(pause.started, true);
  const second = store.add({ ...meta, sceneName: 'Second export' }, image);
  await tick(); assert.equal(fixture.operations.filter((op) => op.kind === 'set').length, 1);
  pause.release(); const [a, b] = await Promise.all([first, second]);
  const entries = await store.list();
  assert.equal(entries.length, 40); assert.ok(entries.some((entry) => entry.id === a.id)); assert.ok(entries.some((entry) => entry.id === b.id));
  assert.equal(entries.some((entry) => ['old-38', 'old-39'].includes(entry.id)), false);
  assert.ok(await store.getImageBlob(a.id)); assert.ok(await store.getImageBlob(b.id));
}

// Metadata failure must not leave a saved scene referencing deleted images.
// Once metadata commits, failed orphan cleanup does not undo logical deletion.
{
  const fixture = storageFixture(); seedScenes(fixture, [scene('a'), scene('b')]);
  fixture.images.set('thumb:a', 'thumbnail');
  const { localSceneStore: store } = await loadStore('../src/storage/localSceneStore.ts', fixture);
  const original = fixture.raw.get(sceneKey), originalImage = fixture.images.get('decal:a');
  fixture.failWrites('Quota exceeded');
  await assert.rejects(store.deleteScene('a'), /Quota exceeded/);
  assert.equal(fixture.raw.get(sceneKey), original);
  assert.equal(fixture.images.get('decal:a'), originalImage); assert.equal(fixture.images.get('thumb:a'), 'thumbnail');
  fixture.failWrites(null); fixture.failIdb('del', 'Cleanup unavailable');
  // Remaining b has no thumbnail, so saveScenes also calls del for thumb:b;
  // set that retained thumbnail to ensure this fault specifically hits cleanup.
  fixture.images.set('thumb:b', 'retained-thumbnail');
  await store.deleteScene('a');
  assert.deepEqual((await store.loadScenes()).map((entry) => entry.id), ['b']);
  assert.ok(fixture.images.has('decal:a'), 'failed cleanup may leave an unused blob');
}

// Failed history metadata writes preserve every existing image, including the
// oldest image that would otherwise be evicted by a new render at the limit.
{
  const fixture = storageFixture(); seedHistory(fixture, 40);
  const { localRenderHistory: store } = await loadStore('../src/storage/localRenderHistory.ts', fixture);
  const original = fixture.raw.get(historyKey), imageKeys = [...fixture.images.keys()].sort();
  fixture.failWrites('Quota exceeded');
  await assert.rejects(store.add(meta, image), /Quota exceeded/);
  assert.equal(fixture.raw.get(historyKey), original); assert.deepEqual([...fixture.images.keys()].sort(), imageKeys);
  await assert.rejects(store.remove('old-0'), /Quota exceeded/);
  await assert.rejects(store.clear(), /Quota exceeded/);
  assert.equal(fixture.raw.get(historyKey), original); assert.deepEqual([...fixture.images.keys()].sort(), imageKeys);
  fixture.failWrites(null); fixture.failIdb('del', 'Cleanup unavailable');
  const added = await store.add(meta, image);
  assert.ok((await store.list()).some((entry) => entry.id === added.id));
  await store.remove(added.id);
  assert.equal((await store.list()).some((entry) => entry.id === added.id), false);
  await store.clear(); assert.deepEqual(await store.list(), []);
}

// Clear/remove and new render completion are ordered by invocation. A new
// render queued during Clear survives, and a later Remove cannot erase others.
{
  const fixture = storageFixture(); seedHistory(fixture, 3);
  const { localRenderHistory: store } = await loadStore('../src/storage/localRenderHistory.ts', fixture);
  const pause = fixture.pauseNext('del', (key) => key === 'render-image:old-0');
  const clearing = store.clear(); await tick(); assert.equal(pause.started, true);
  const added = store.add({ ...meta, sceneName: 'After clear' }, image);
  await tick(); assert.equal(fixture.operations.some((op) => op.kind === 'set'), false);
  pause.release(); await clearing; const entry = await added;
  assert.deepEqual((await store.list()).map((item) => item.id), [entry.id]);
  const removing = store.remove(entry.id), replacement = store.add(meta, image);
  await removing; const finalEntry = await replacement;
  assert.deepEqual((await store.list()).map((item) => item.id), [finalEntry.id]);
  assert.equal(await store.getImageBlob(entry.id), null); assert.ok(await store.getImageBlob(finalEntry.id));
}

// Failed history reads neither fake an empty list nor write image data; failed
// mutations release their lock for a later explicit retry.
{
  const fixture = storageFixture();
  const { localRenderHistory: store } = await loadStore('../src/storage/localRenderHistory.ts', fixture);
  assert.deepEqual(await store.list(), []);
  for (const malformed of ['{broken', '{}', '']) {
    fixture.raw.set(historyKey, malformed); fixture.operations.length = 0;
    await assert.rejects(store.list()); await assert.rejects(store.add(meta, image)); await assert.rejects(store.clear());
    assert.equal(fixture.raw.get(historyKey), malformed); assert.equal(fixture.operations.length, 0);
  }
  seedHistory(fixture, 2); const original = fixture.raw.get(historyKey);
  fixture.failReads('Storage unavailable');
  await assert.rejects(store.remove('old-0'), /Storage unavailable/);
  assert.equal(fixture.raw.get(historyKey), original); assert.ok(fixture.images.has('render-image:old-0'));
  fixture.failReads(null); fixture.failIdb('set', 'Image write failed', true);
  const failure = assert.rejects(store.add(meta, image), /Image write failed/);
  const retry = store.add(meta, image);
  await failure; const entry = await retry;
  assert.equal((await store.list()).length, 3); assert.ok(await store.getImageBlob(entry.id));
}

delete globalThis.__smartInkStorageTest;
delete globalThis.localStorage;
console.log('Local storage checks passed: read/commit failures preserve data and images, absent IDs reject, scene mutations serialize, legacy images/lights survive, concurrent history at 40 entries, clear/remove races, best-effort cleanup, failure recovery.');
