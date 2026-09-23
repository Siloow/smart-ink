// Run: node tools/render-service.test.mjs. Uses the actual bundled service, no browser/network.
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const built = await build({
  entryPoints: ['src/services/cloudRenderService.ts'], bundle: true, write: false,
  format: 'esm', platform: 'node',
  define: { 'import.meta.env.DEV': 'true', 'import.meta.env.VITE_RENDER_URL': 'undefined' },
});
const service = await import(`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString('base64')}`);
const contract = {
  schemaVersion: 1, bodyMeshId: 'body_full', skinToneId: 'tone_03', poseId: 'neutral',
  lookId: 'studio_softbox', inkTextureUrl: 'ink.png',
  camera: { position: [0, 0, 8], target: [0, 0, 0], fov: 45, aspect: 1 },
  output: { qualityTier: 'preview', width: 512, height: 512 },
};
const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAarVyFEAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });
const originalFetch = globalThis.fetch;
const originalCreate = URL.createObjectURL;
const originalBitmap = globalThis.createImageBitmap;
let created = 0, decoded = 0, closed = 0;
URL.createObjectURL = (blob) => {
  assert.equal(blob.type, 'image/png');
  created++;
  return `blob:test-${created}`;
};
globalThis.createImageBitmap = async () => {
  decoded++;
  return { close() { closed++; } };
};
function pendingFetch(_url, { signal }) {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

try {
  const statuses = [];
  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/render-v2');
    assert.equal(options.method, 'POST');
    assert.equal(options.body.get('ink_layer').name, 'ink.png');
    assert.deepEqual(JSON.parse(await options.body.get('contract').text()), contract);
    assert.ok(options.signal instanceof AbortSignal);
    return new Response(png);
  };
  assert.equal(await service.renderContract(contract, png, { onStatusChange: (status) => statuses.push(status) }), 'blob:test-1');
  assert.deepEqual(statuses, ['uploading', 'rendering', 'done']);
  assert.equal(decoded, 1);
  assert.equal(closed, 1);

  const before = created;
  globalThis.fetch = async () => new Response('<html>Proxy failed</html>', { status: 200 });
  await assert.rejects(service.renderContract(contract, png), /did not return a PNG/);
  globalThis.fetch = async () => new Response(await png.slice(0, 40).arrayBuffer());
  await assert.rejects(service.renderContract(contract, png), /incomplete/);
  globalThis.fetch = async () => new Response(png);
  globalThis.createImageBitmap = async () => { throw new Error('Decode failed'); };
  await assert.rejects(service.renderContract(contract, png), /could not be decoded/);
  globalThis.createImageBitmap = async () => ({ close() {} });
  assert.equal(created, before, 'Invalid responses must never enter image history');

  for (const [status, response, message] of [
    [422, { detail: 'Unsupported contract' }, 'Unsupported contract'],
    [429, { detail: 'Server busy' }, 'Server busy'],
    [500, { error: 'Blender unavailable' }, 'Blender unavailable'],
    [504, { detail: [{ msg: 'Timed out' }] }, 'Timed out'],
  ]) {
    globalThis.fetch = async () => Response.json(response, { status });
    const events = [];
    await assert.rejects(service.renderContract(contract, png, { onStatusChange: (event) => events.push(event) }), (error) => error.message === message);
    assert.equal(events.at(-1), 'error');
  }

  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(png); };
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(service.renderContract(contract, png, { signal: cancelled.signal }), { name: 'AbortError' });
  await assert.rejects(service.renderContract({ ...contract, bodyMeshId: 'missing' }, png), /unknown bodyMeshId/);
  assert.equal(requests, 0, 'Invalid/already-cancelled requests must not reach the server');

  globalThis.fetch = pendingFetch;
  const controller = new AbortController();
  const events = [];
  const cancelledRender = service.renderContract(contract, png, { signal: controller.signal, onStatusChange: (event) => events.push(event) });
  controller.abort();
  await assert.rejects(cancelledRender, { name: 'AbortError' });
  assert.equal(events.at(-1), 'cancelled');
  const timeoutEvents = [];
  await assert.rejects(service.renderContract(contract, png, { timeoutMs: 15, onStatusChange: (event) => timeoutEvents.push(event) }), { name: 'TimeoutError' });
  assert.equal(timeoutEvents.at(-1), 'error');
  assert.equal(created, before);

  globalThis.fetch = async () => Response.json({ ok: true, ready: false, message: 'Missing Blender', active_renders: 2, timeout_seconds: 600, cancellation_supported: true });
  assert.deepEqual(await service.getRenderServerStatus(), {
    online: true, ready: false, message: 'Missing Blender', activeRenders: 2, timeoutSeconds: 600, cancellationSupported: true,
  });
  assert.equal(await service.checkRenderServer(), false);
  globalThis.fetch = async () => Response.json({ ok: true });
  assert.equal(await service.checkRenderServer(), true, 'Legacy cloud health remains compatible');
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  assert.deepEqual(await service.getRenderServerStatus(), { online: false, ready: false, message: 'Cannot reach the render server.' });
  globalThis.fetch = async () => new Response('unavailable', { status: 503 });
  assert.equal((await service.getRenderServerStatus()).online, true);
  assert.equal(await service.checkRenderServer(), false);

  globalThis.fetch = async (url, options) => {
    assert.equal(url, '/sync-live');
    assert.equal(options.body.get('ink_layer').name, 'ink.png');
    return Response.json({ ok: true });
  };
  await service.syncToLiveWatcher(contract, png);
  globalThis.fetch = pendingFetch;
  await assert.rejects(service.syncToLiveWatcher(contract, png, { timeoutMs: 15 }), { name: 'TimeoutError' });
  console.log('Render service: multipart success, PNG decoding, rejection, abort, timeout, readiness, legacy cloud and live sync passed.');
} finally {
  globalThis.fetch = originalFetch;
  URL.createObjectURL = originalCreate;
  if (originalBitmap) globalThis.createImageBitmap = originalBitmap;
  else delete globalThis.createImageBitmap;
}
