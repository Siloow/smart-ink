// Run: node tools/render-proxy.test.mjs. Exercise the real proxy hook without opening a port.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';

const config = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
const hook = config.match(/configure\(proxy\) \{([\s\S]*?)\n {8}\},/);
assert.ok(hook, 'The render proxy must forward disconnects before a response starts');
const configure = new Function('proxy', hook[1]);
const proxy = new EventEmitter();
configure(proxy);

for (const completed of [false, true]) {
  const browserResponse = new EventEmitter();
  browserResponse.writableEnded = completed;
  let destroyed = 0;
  const upstream = { destroy() { destroyed++; } };
  // Body fully uploaded; no upstream response yet. http-proxy's default aborted
  // request and proxyRes listeners do not cover this Blender render interval.
  const uploadedRequest = { complete: true };
  proxy.emit('proxyReq', upstream, uploadedRequest, browserResponse);
  assert.equal(destroyed, 0);
  browserResponse.emit('close');
  assert.equal(destroyed, completed ? 0 : 1);
}
console.log('Render proxy: disconnect during render destroys upstream; completed response stays intact.');
