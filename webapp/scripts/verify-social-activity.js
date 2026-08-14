'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const api = fs.readFileSync(path.join(__dirname, '..', 'routes', 'api.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');

assert.match(api, /router\.get\('\/workouts\/:id\/social'/, 'social activity endpoint is required');
assert.match(api, /postVisibleTo\(post, me\)/, 'social activity must use the post visibility policy');
assert.match(api, /publishedRoute\(post\)/, 'social activity must use only the author-trimmed route');
assert.match(api, /can_encourage: post\.user_id !== me && followsAuthor/, 'only following members may receive encouragement controls');
assert.match(app, /function renderSharedWorkoutDetail\(id\)/, 'a shared activity needs a detail view');
assert.match(app, /data-shared-workout/, 'friends workout cards need a detail action');
assert.match(app, /Only the details/, 'the detail view must disclose its privacy boundary');
assert.match(index, /app\.js\?v=ff-[a-z0-9-]+/, 'the app bundle must be cache-busted');
assert.match(sw, /functioning-faith-shell-v\d+/, 'the service worker shell cache must be versioned');

console.log('social activity detail checks passed');
