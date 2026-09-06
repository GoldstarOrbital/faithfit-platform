'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { versionShell } = require('../lib/asset-shell');
const listeners = {};
let offline = false, status = 200, networkCalls = 0, stored = 0;
const cached = { marker: 'old' };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/sw.js'), 'utf8'), {
  self: { location: { origin: 'https://example.test' }, addEventListener: (name, fn) => { listeners[name] = fn; } },
  URL, Response,
  caches: { match: async () => cached, open: async () => ({ put: async () => { stored++; } }) },
  fetch: async (_request, options) => {
    networkCalls++;
    assert.equal(options.cache, 'no-cache');
    if (offline) throw new Error('offline');
    return { marker: 'new', ok: status === 200, type: 'basic', clone() { return this; } };
  },
});
async function main() {
  const html = '<script src="/app.js?v=old"></script><link href="/styles.css?v=old"><script src="https://example.test/external.js"></script>';
  const original = versionShell(html, asset => asset + 'v1');
  assert.equal(versionShell(html, asset => asset + 'v1'), original);
  const changed = versionShell(html, asset => asset + (asset === '/app.js' ? 'v2' : 'v1'));
  assert.notEqual(changed.match(/app.js\?v=[a-f0-9]+/)[0], original.match(/app.js\?v=[a-f0-9]+/)[0]);
  assert.equal(changed.match(/styles.css\?v=[a-f0-9]+/)[0], original.match(/styles.css\?v=[a-f0-9]+/)[0]);
  assert.ok(changed.includes('https://example.test/external.js'));
  // Validate every real shell reference exists as part of the release gate.
  const publicRoot = path.join(__dirname, '../public');
  versionShell(fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8'), asset => fs.readFileSync(path.join(publicRoot, asset.slice(1))));
  function request(path) {
    let result;
    listeners.fetch({ request: { method: 'GET', mode: 'cors', url: `https://example.test${path}` }, respondWith: value => { result = value; } });
    return result;
  }
  assert.equal((await request('/app.js?v=same-old-version')).marker, 'new');
  await Promise.resolve();
  assert.equal(stored, 1);
  offline = true;
  assert.equal((await request('/app.js?v=same-old-version')).marker, 'old');
  offline = false; status = 500;
  assert.equal((await request('/app.js?v=same-old-version')).marker, 'old');
  assert.equal(stored, 1, 'do not cache errors');
  assert.equal(request('/api/feed?v=1'), undefined, 'never intercept private API traffic');
  assert.equal(networkCalls, 3);
  console.log('Shell cache: new deployment wins, offline fallback works, errors and API responses are not cached.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
