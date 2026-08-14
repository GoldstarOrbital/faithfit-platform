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
assert.match(index, /app\.js\?v=ff-scripture-collection-1/, 'the new app bundle must be requested');
assert.match(sw, /functioning-faith-shell-v35/, 'the shell cache must rotate for Scripture saves');

console.log('scripture collection checks passed');
