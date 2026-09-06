'use strict';
// Workout distance is the one number a member submits that feeds SHARED
// surfaces -- the community leaderboard, challenge and journey progress,
// personal bests, and stats totals -- so it is the one most worth pinning
// down. Every other number the stop handler accepts is already bounded
// (sport_metrics has per-key ceilings, gps_path drops non-finite
// coordinates); distance used to go straight from the request body into the
// row. Unbounded, one request tops the leaderboard permanently; non-numeric,
// SQLite stores it as text and the DM workout-share route later throws on
// .toFixed().
//
// Executes the real validation expression lifted out of routes/api.js rather
// than a copy of it, so this cannot pass against a duplicate that has since
// drifted from production.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');
const handler = source.split("router.post('/workouts/:id/stop'")[1];
assert.ok(handler, 'could not find the workout stop handler');

const validation = handler.match(/const submittedDistance = [\s\S]*?: null;/);
assert.ok(validation, 'could not find the distance validation in the stop handler');

const distanceFor = (gps_distance_km) =>
  vm.runInNewContext(`${validation[0]}; distanceKm;`, { gps_distance_km });

// Real distances survive, rounded to metres.
assert.equal(distanceFor(5), 5);
assert.equal(distanceFor(42.195), 42.195);
assert.equal(distanceFor(0.0001234), 0);
assert.equal(distanceFor(1000), 1000, 'the ceiling itself is a legitimate distance');

// A numeric string is what an HTTP body most often actually carries.
assert.equal(distanceFor('12.5'), 12.5, 'numeric strings must coerce, not be rejected');
assert.equal(typeof distanceFor('12.5'), 'number', 'never store text in a REAL column');

// Nothing that would corrupt a shared ranking or crash a later .toFixed().
for (const bad of [0, -1, -9999, 1000.001, 1e9, Infinity, -Infinity, NaN,
                   'abc', '', null, undefined, {}, [], true]) {
  assert.equal(distanceFor(bad), null, `rejected: ${String(bad)}`);
}

// The stored value, the response, and every downstream consumer must all read
// the validated number -- not the raw body, which was the original bug.
const stop = handler.split('res.json(')[0];
assert.ok(!/gps_distance_km\s*\|\|/.test(stop),
  'the raw request value must never be used directly -- use the validated distanceKm');
assert.match(stop, /\.run\(avgHr, maxHr, calories, distanceKm,/, 'the row stores the validated distance');
assert.match(stop, /applyWorkoutToChallenges\([^)]*distance_km: distanceKm/, 'challenges use the validated distance');
assert.match(stop, /applyWorkoutToJourneys\([^)]*distance_km: distanceKm/, 'journeys use the validated distance');

console.log('Workout distance: real distances kept, out-of-range and non-numeric rejected, shared surfaces read the validated value.');
