'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const sw = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const index = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

assert.match(app, /function openWorkoutEncouragement\(recipientId, recipientName, workoutType\)/, 'friends workouts need a Scripture encouragement flow');
assert.match(app, /data-workout-encourage/, 'each friend workout needs an encouragement action');
assert.match(app, /Hebrews 12:1/, 'movement encouragement needs a running-specific verse');
assert.match(app, /\/dms\/with\//, 'encouragement must use the protected DM thread opener');
assert.match(app, /\/verse`, \{ method: 'POST'/, 'encouragement must send a verified verse card, not unverified text');
assert.match(app, /minor protections, rate limits/, 'the UI must preserve existing message protections');
assert.match(index, /app\.js\?v=ff-[a-z0-9-]+/, 'the app bundle must be cache-busted');
assert.match(sw, /functioning-faith-shell-v\d+/, 'the service worker shell cache must be versioned');

console.log('workout encouragement checks passed');
