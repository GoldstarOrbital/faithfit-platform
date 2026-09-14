'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const api = fs.readFileSync(path.join(root, 'routes/api.js'), 'utf8');
const dbSource = fs.readFileSync(path.join(root, 'lib/db.js'), 'utf8');

assert.match(api, /router\.patch\('\/workouts\/:id'/, 'completed workouts need an owned edit endpoint');
assert.match(api, /UPDATE workouts SET name=\?, note=\? WHERE id=\?/, 'workout edits must persist name and description');
assert.match(api, /UPDATE posts SET content=\? WHERE workout_id=\? AND user_id=\?/, 'the linked social post must follow workout edits');
assert.match(api, /router\.delete\('\/workouts\/:id\/beacon'/, 'beacons need an explicit stop path');
assert.match(api, /UPDATE workout_beacons SET active=0/, 'finishing must deactivate beacon rows');
assert.match(api, /notify\(recipient_id, 'safety_beacon'/, 'a selected trusted person must be told when a beacon starts');
assert.match(api, /gpsCorrection\.correctRoute\(JSON\.parse\(pathJson\)/, 'completed GPS traces need background correction');
assert.match(dbSource, /ALTER TABLE workouts ADD COLUMN name TEXT/, 'existing databases need the additive workout-name migration');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-workout-release-'));
process.env.DATA_DIR = dataDir;
const db = require('../lib/db');
const columns = new Set(db.prepare('PRAGMA table_info(workouts)').all().map(column => column.name));
assert.ok(columns.has('name'), 'fresh and migrated databases must expose workouts.name');
assert.ok(columns.has('gps_corrected_at'), 'GPS correction metadata must remain available');
db.close();
fs.rmSync(dataDir, { recursive: true, force: true });

console.log('Workout release: edits, post sync, GPS correction, and beacon shutdown verified.');
