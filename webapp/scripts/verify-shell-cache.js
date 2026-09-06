'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
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
