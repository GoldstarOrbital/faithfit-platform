#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const app = read('public', 'app.js');
const css = read('public', 'styles.css');
const html = read('public', 'index.html');
const sw = read('public', 'sw.js');
const saves = read('lib', 'verse-saves.js');

assert.match(app, /OFFLINE_SAVED_VERSES_PREFIX/, 'saved verses need a versioned local-only cache');
assert.match(app, /OFFLINE_SAVED_VERSES_PREFIX \+ userId/, 'offline Scripture must be scoped to the signed-in member');
assert.match(app, /function loadSavedVerses\(\)/, 'the saved collection needs an online-first, offline fallback loader');
assert.match(app, /readOfflineSavedVerses\(\)\.find\(item => item\.reference === reference\)/, 'a saved verse needs a readable offline detail view');
assert.match(app, /clearOfflineSavedVerses\(\); state\.me = null/, 'sign-out and deletion must clear private offline Scripture');
assert.match(app, /Offline reading mode/, 'members need an honest offline indicator');
assert.match(saves, /Return the same server-verified row/, 'new offline rows must originate from server-verified Scripture');
assert.match(css, /\.offline-scripture-note/, 'offline state needs visible styling');
// These last two used to pin the hand-written label scheme -- `?v=ff-…-1` in
// index.html and a `-v43`-style cache name -- which is exactly what content
// hashing replaced. They had been failing since the label changed, unnoticed,
// because this script was never added to CI. Assert the property they were
// really after (the shell is versioned by something that changes with its
// bytes, and offline reading has a shell to start from) rather than the
// mechanism, so the next improvement to versioning does not silently break
// the offline-Scripture gate again. The versioning itself is covered in
// detail by verify-shell-cache.js.
const { versionShell, shellAssets, versionServiceWorker } = require('../lib/asset-shell');
const publicRoot = path.join(__dirname, '..', 'public');
const servedHtml = versionShell(html, asset => fs.readFileSync(path.join(publicRoot, asset.slice(1))));
const assets = shellAssets(servedHtml);
assert.match(servedHtml, /app\.js\?v=[0-9a-f]{16}/, 'the script bundle must be versioned by its contents');
assert.ok(assets.some(url => url.startsWith('/app.js?v=')), 'the bundle that reads offline Scripture must be in the shell');
const servedSw = versionServiceWorker(sw, assets);
assert.match(servedSw, /const SHELL_CACHE = 'functioning-faith-shell-[0-9a-f]{12}';/,
  'the shell cache must be named after its contents');
for (const url of assets) {
  assert.ok(servedSw.includes(`'${url}'`),
    `${url} must be precached, or offline Scripture has no app to open in`);
}
// Scripture is the one thing in this app that should open with no connection.
// Verified against a running server when added: passage 7d, search and
// coverage 1h, the not-yet-ingested 404 and /bible/random both no-store.
const api = read('routes', 'api.js');
const passage = api.split("router.get('/bible/passage/:book/:chapter'")[1].split('router.')[0];
assert.ok(passage.indexOf("res.status(404)") < passage.indexOf('cacheScripture(res)'),
  'a chapter outside the ingested subset must answer 404 uncached -- caching it would keep answering 404 after the chapter is ingested');
assert.match(api, /const SCRIPTURE_MAX_AGE = 7 \* 24 \* 60 \* 60;/,
  'a chapter already read must stay readable offline for a useful stretch');
assert.match(api, /function cacheScripture\(res, seconds = SCRIPTURE_MAX_AGE\)/, 'scripture caching goes through one helper');

const random = api.split("router.get('/bible/random'")[1].split('router.')[0];
assert.ok(!random.includes('cacheScripture'), 'caching /bible/random would stop it being random');

// Scripture is cacheable because it is public-domain text with no member in
// it. Anything member-scoped must never pick this up.
for (const route of ["router.get('/verses/saved'", "router.get('/bible/ask/history'"]) {
  const body = api.split(route)[1].split('router.')[0];
  assert.ok(!body.includes('cacheScripture'), `${route} is member-scoped and must not be publicly cacheable`);
}

console.log(JSON.stringify({ private_offline_scripture: true, account_scoped: true, cache_busted: true, scripture_readable_offline: true }));
