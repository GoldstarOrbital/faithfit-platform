'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const saves = fs.readFileSync(path.join(__dirname, '..', 'lib', 'verse-saves.js'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'routes', 'api.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');

assert.match(saves, /CREATE TABLE IF NOT EXISTS saved_verses/, 'saved Scripture needs private storage');
assert.match(saves, /UNIQUE\(user_id, reference\)/, 'a member can save a verse only once');
assert.match(saves, /FROM saved_verses WHERE user_id = \?/, 'a collection must be scoped to its member');
assert.match(api, /router\.get\('\/verses\/saved'/, 'a private saved-verses read endpoint is required');
assert.match(api, /router\.post\('\/verses\/save'/, 'a verified save toggle endpoint is required');
assert.match(api, /resolveVerseReferenceFull/, 'the server must verify a verse before saving it');
assert.match(api, /saved_verses: verseSaves\.list\(uid\)/, 'data export must include saved Scripture');
assert.match(app, /data-verse-save/, 'verse cards need a save action');
assert.match(app, /function renderSavedVerses\(main\)/, 'Profile needs a saved Scripture collection');
assert.match(app, /saved-verses-open/, 'Profile must link to the saved Scripture collection');
// The bundle is versioned by its contents at serve time, not by a label in
// the file -- see lib/asset-shell.js. This assertion used to pin the old
// `?v=ff-...-1` label and had been failing unnoticed since that label changed,
// because this script is not run by CI. verify-shell-cache.js covers the
// versioning mechanism itself in detail.
const { versionShell } = require('../lib/asset-shell');
const servedShell = versionShell(index, asset => fs.readFileSync(path.join(__dirname, '..', 'public', asset.slice(1))));
assert.match(servedShell, /app\.js\?v=[0-9a-f]{16}/, 'the app bundle must be versioned by its contents');
assert.match(sw, /functioning-faith-shell-v\d+/, 'the shell cache must be versioned');

console.log('scripture collection checks passed');
