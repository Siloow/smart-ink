/** PNG validation/decoding failure and cancellation checks; no browser needed. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const { outputFiles } = await build({
  entryPoints: [fileURLToPath(new URL('../src/utils/tattooUpload.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { readTattooPng, MAX_TATTOO_BYTES } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);

function png(width = 64, height = 32, type = 'image/png') {
  const bytes = new Uint8Array(33);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return new File([bytes], 'design.png', { type });
}

let readMode = 'ok', decodeMode = 'ok';
let readers = [], imageCount = 0;
class MockReader {
  constructor() { readers.push(this); }
  async readAsDataURL(file) {
    if (readMode === 'hold') return;
    if (readMode === 'error') { queueMicrotask(() => this.onerror?.()); return; }
    this.result = `data:image/png;base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`;
    this.onload?.();
  }
  abort() { this.aborted = true; this.onabort?.(); }
}
class MockImage {
  naturalWidth = 64;
  naturalHeight = 32;
  set src(value) {
    if (!value) return;
    imageCount++;
    if (decodeMode === 'hold') return;
    queueMicrotask(() => {
      if (decodeMode === 'error') this.onerror?.();
      else { if (decodeMode === 'invalid-size') this.naturalWidth = 0; this.onload?.(); }
    });
  }
}
const originalReader = globalThis.FileReader, originalImage = globalThis.Image;
globalThis.FileReader = MockReader;
globalThis.Image = MockImage;
const settle = () => new Promise((resolve) => setImmediate(resolve));
try {
  const source = await readTattooPng(png());
  assert.ok(source.startsWith('data:image/png;base64,'));
  assert.equal(imageCount, 1, 'valid input is decoded before the promise resolves');
  await readTattooPng(png(64, 32, ''));
  await assert.rejects(readTattooPng(png(64, 32, 'image/jpeg')), /Choose a PNG/);
  await assert.rejects(readTattooPng(new File(['not a PNG'], 'renamed.png', { type: 'image/png' })), /not a valid PNG/);
  await assert.rejects(readTattooPng(new File([], 'empty.png', { type: 'image/png' })), /not a valid PNG/);
  await assert.rejects(readTattooPng({ type: 'image/png', size: MAX_TATTOO_BYTES + 1 }), /20 MB/);
  const beforeReaders = readers.length;
  await assert.rejects(readTattooPng(png(8193, 1)), /too large/);
  await assert.rejects(readTattooPng(png(8192, 8192)), /too large/);
  assert.equal(readers.length, beforeReaders, 'oversized decoded dimensions are rejected before reading/decoding the full image');
  await assert.rejects(readTattooPng({ type: 'image/png', size: 33, slice: () => ({ arrayBuffer: async () => { throw new Error('disk failure'); } }) }), /could not be read/);
  readMode = 'error';
  await assert.rejects(readTattooPng(png()), /could not be read/);
  readMode = 'ok'; decodeMode = 'error';
  await assert.rejects(readTattooPng(png()), /could not be opened/);
  decodeMode = 'invalid-size';
  await assert.rejects(readTattooPng(png()), /too large/);
  decodeMode = 'ok';

  const preCancelled = new AbortController(); preCancelled.abort();
  await assert.rejects(readTattooPng(png(), preCancelled.signal), { name: 'AbortError' });
  const oldRequest = new AbortController(); readMode = 'hold';
  const oldUpload = readTattooPng(png(), oldRequest.signal);
  await settle();
  const oldReader = readers.at(-1);
  oldRequest.abort();
  await assert.rejects(oldUpload, { name: 'AbortError' });
  assert.equal(oldReader.aborted, true, 'superseded reading is stopped');
  readMode = 'ok';
  assert.ok((await readTattooPng(png())).startsWith('data:image/png'), 'replacement request succeeds after cancelling an older one');

  decodeMode = 'hold';
  const decodeRequest = new AbortController();
  const decoding = readTattooPng(png(), decodeRequest.signal);
  await settle(); decodeRequest.abort();
  await assert.rejects(decoding, { name: 'AbortError' });
  console.log('Tattoo uploads: valid PNG, headers, size/dimensions, read/decode failures and cancellation passed.');
} finally {
  if (originalReader === undefined) delete globalThis.FileReader; else globalThis.FileReader = originalReader;
  if (originalImage === undefined) delete globalThis.Image; else globalThis.Image = originalImage;
  readers = [];
}
