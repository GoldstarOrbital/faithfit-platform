#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('node:vm');
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

// Per-chapter caching only ever gives offline access to chapters already
// opened online. /bible/offline is what makes Scripture work with no
// connection at all, so its shape is worth pinning: the whole thing is only
// affordable because the response does not repeat the book, chapter, verse
// and translation on all 31k rows.
{
  const os = require('os');
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-bible-'));
  const db = require('../lib/db');
  db.exec('CREATE TABLE IF NOT EXISTS bible_verses (book TEXT, chapter INTEGER, verse INTEGER, text TEXT, translation TEXT)');
  db.exec("DELETE FROM bible_verses");
  const add = db.prepare('INSERT INTO bible_verses (book, chapter, verse, text, translation) VALUES (?,?,?,?,?)');
  add.run('John', 3, 15, 'that whoever believes may have eternal life.', 'WEB');
  add.run('John', 3, 16, 'For God so loved the world', 'WEB');
  add.run('Genesis', 1, 1, 'In the beginning', 'WEB');
  // A real gap: WEB follows the critical text, so Acts 8:37 does not exist.
  // Indexing by verse-1 leaves a hole, and JSON.stringify emits holes as null.
  // A typed client decoding a list of strings refuses null and loses the whole
  // Bible over one absent verse, so the response must never contain one.
  add.run('Acts', 8, 36, 'What is stopping me from being baptized?', 'WEB');
  add.run('Acts', 8, 38, 'He commanded the chariot to stand still.', 'WEB');

  const build = api.match(/let offlineBibleCache = null;[\s\S]*?\n}\n/);
  assert.ok(build, 'could not find the offline Bible builder');
  const offlineBible = vm.runInNewContext(`${build[0]}; offlineBible;`, { db, JSON, createHash: require('crypto').createHash });

  const first = offlineBible();
  const body = JSON.parse(first.body);
  assert.equal(body.verses, 5, 'every ingested verse ships');

  // Checked structurally, not as a substring: Scripture itself contains the
  // letters "null" (Hebrews 7:18, "an annulling of a former commandment"), so
  // searching the raw body for it reports a problem that is not there.
  const nulls = [];
  for (const [book, chapters] of Object.entries(body.books)) {
    for (const [chapter, verses] of Object.entries(chapters)) {
      verses.forEach((text, index) => {
        if (typeof text !== 'string') nulls.push(`${book} ${chapter}:${index + 1}`);
      });
    }
  }
  assert.deepEqual(nulls, [],
    'a gap in verse numbering must not serialise as null -- a typed client would refuse the whole Bible over one absent verse');
  assert.deepEqual(body.books.Acts['8'], ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
    '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
    'What is stopping me from being baptized?', '', 'He commanded the chariot to stand still.'],
    'the absent verse is an empty string, and the surrounding verses keep their real numbers');
  assert.equal(body.books.John['3'][15], 'For God so loved the world', 'verse N lands at index N-1');
  assert.equal(body.books.Genesis['1'][0], 'In the beginning');
  assert.equal(body.translations.John, 'WEB', 'translation is carried once per book, not per verse');
  assert.ok(!first.body.includes('"chapter"'), 'the shape must not repeat chapter on every row');

  assert.equal(offlineBible(), first, 'built once and kept -- rebuilding 31k rows per request is the expensive way to serve a file that never changes');
  assert.match(first.etag, /^"[0-9a-f]{24}"$/, 'a strong ETag, so a returning device revalidates into a 304');

  const route = api.split("router.get('/bible/offline'")[1].split('router.')[0];
  assert.match(route, /if \(req\.headers\['if-none-match'\] === etag\) return res\.status\(304\)\.end\(\);/,
    'a device that already has it must not pull another megabyte');
  assert.ok(route.includes('cacheScripture(res)'), 'the offline Bible is cached like the rest of Scripture');
  try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch {}
}

console.log(JSON.stringify({ private_offline_scripture: true, account_scoped: true, cache_busted: true, scripture_readable_offline: true, whole_bible_offline: true }));
