'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { versionShell, shellAssets, shellCacheName, versionServiceWorker, FINGERPRINT } = require('../lib/asset-shell');
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
  const realShell = versionShell(fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8'),
    asset => fs.readFileSync(path.join(publicRoot, asset.slice(1))));

  // The worker precaches by exact URL. Once versions became content hashes,
  // the hand-written SHELL list in sw.js could no longer match what the page
  // requests -- and it failed silently in the worst direction: every entry it
  // downloaded was a URL nobody asks for, while nothing the page actually
  // loads was precached at all. Serving sw.js through versionServiceWorker is
  // what keeps the two in step; this asserts they are.
  const assets = shellAssets(realShell);
  assert.ok(assets.length >= 10, `expected the shell to reference its assets, saw ${assets.length}`);
  const served = versionServiceWorker(fs.readFileSync(path.join(publicRoot, 'sw.js'), 'utf8'), assets);
  const precached = [...served.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);

  assert.deepEqual(precached.filter(url => url !== '/'), assets,
    'the worker must precache exactly the URLs the shell requests, in order');
  assert.ok(precached.includes('/'), 'the navigation fallback stays precached');
  assert.equal(served.match(/const SHELL_CACHE = '([^']*)'/)[1],
    shellCacheName(assets), 'the cache is named after its contents');

  // A changed asset must retire the old cache on activate by itself, without
  // anyone remembering to bump a version by hand.
  assert.notEqual(shellCacheName(assets), shellCacheName([...assets, '/new.js?v=abc']),
    'a different asset list is a different cache');

  // Only a content hash earns a year in cache. A reused label is exactly what
  // stranded returning visitors on old JavaScript, twice.
  assert.ok(FINGERPRINT.test('7d22d19a64cff8c1') && !FINGERPRINT.test('ff-googlehealth-1'),
    'only computed hashes count as fingerprints');
  for (const url of assets) {
    const version = url.split('?v=')[1];
    if (/\.(?:js|css)$/.test(url.split('?')[0])) {
      assert.ok(FINGERPRINT.test(version), `${url} must be content-hashed to be cacheable`);
    }
  }
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
