#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const reels = read('lib', 'reels.js');
const api = read('routes', 'api.js');
const app = read('public', 'app.js');
const html = read('public', 'index.html');
const sw = read('public', 'sw.js');

assert.match(reels, /CREATE TABLE IF NOT EXISTS reel_hides/, 'private Reel preference storage must exist');
assert.match(reels, /NOT EXISTS \(SELECT 1 FROM reel_hides h/, 'catalogue feed must exclude private hidden clips');
assert.match(api, /router\.post\('\/reels\/:videoId\/not-interested'/, 'the API needs a private not-interested route');
assert.match(api, /INSERT OR IGNORE INTO reel_hides/, 'not-interested requests must be idempotent');
assert.match(api, /videos = videos\.filter\(video => !hiddenIds\.has/, 'mixed feeds must also remove private hidden clips');
assert.match(api, /'reel_impressions', 'reel_reactions', 'reel_hides'/, 'account deletion must remove private Reel preferences');
assert.match(app, /data-reel-not-interested/, 'the member needs a visible not-interested control');
assert.match(app, /\/not-interested/, 'the UI must persist not-interested choices');
// The bundle is versioned by its contents at serve time, not by a label in
// the file -- see lib/asset-shell.js. This assertion used to pin the old
// `?v=ff-...-1` label and had been failing unnoticed since that label changed,
// because this script is not run by CI. verify-shell-cache.js covers the
// versioning mechanism itself in detail.
const { versionShell } = require('../lib/asset-shell');
const servedShell = versionShell(html, asset => fs.readFileSync(path.join(__dirname, '..', 'public', asset.slice(1))));
assert.match(servedShell, /app\.js\?v=[0-9a-f]{16}/, 'the app bundle must be versioned by its contents');
assert.match(sw, /functioning-faith-shell-v\d+/, 'the service worker cache must be versioned');

console.log(JSON.stringify({ private_feed_tuning: true, no_public_penalty: true, cache_busted: true }));
