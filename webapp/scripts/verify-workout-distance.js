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

const helper = source.match(/const MAX_WORKOUT_DISTANCE_KM = [\s\S]*?\nfunction validWorkoutDistanceKm[\s\S]*?\n}/);
assert.ok(helper, 'could not find validWorkoutDistanceKm');

const distanceFor = (value) =>
  vm.runInNewContext(`${helper[0]}; validWorkoutDistanceKm(value);`, { value });

// Real distances survive, rounded to metres.
assert.equal(distanceFor(5), 5);
assert.equal(distanceFor(42.195), 42.195);
// Under half a metre rounds to zero, and zero is not a distance -- "none" is
// null everywhere else in this API, so it must not become a 0 km workout.
assert.equal(distanceFor(0.0001234), null);
assert.equal(distanceFor(0.001), 0.001, 'a metre is still a real, if tiny, distance');
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
assert.match(stop, /const distanceKm = validWorkoutDistanceKm\(gps_distance_km\)/, 'the stop handler validates');
assert.match(stop, /\.run\(avgHr, maxHr, calories, distanceKm,/, 'the row stores the validated distance');
assert.match(stop, /applyWorkoutToChallenges\([^)]*distance_km: distanceKm/, 'challenges use the validated distance');
assert.match(stop, /applyWorkoutToJourneys\([^)]*distance_km: distanceKm/, 'journeys use the validated distance');

// An import or a manual entry must not be the way around the ceiling the stop
// handler enforces. Every INSERT that writes distance_km must reach it through
// the helper, so a newly added path that skips it fails here rather than
// silently becoming the next open door. Inserts with no distance_km column
// (starting a workout, the step-only Google Health import) are not counted.
const writesDistance = [...source.matchAll(/INSERT INTO workouts\s*\(([^)]*)\)/g)]
  .filter(m => /\bdistance_km\b/.test(m[1]));
assert.equal(writesDistance.length, 4, 'expected exactly the four distance-writing workout inserts');

// The value bound to distance_km in each of those must be helper-derived: a
// call, or a local the handler assigned from one.
const callSites = [...source.matchAll(/validWorkoutDistanceKm\(/g)].length - 1; // minus the definition
assert.equal(callSites, 5,
  'four distance-writing inserts plus the stop handler each validate exactly once');

for (const local of ['distanceKm', 'dist']) {
  const assigned = new RegExp(`const ${local} = validWorkoutDistanceKm\\(`);
  assert.match(source, assigned, `${local} must be assigned from the helper`);
}

// duration_min is a ranked leaderboard metric too (LEADERBOARD_METRICS), and
// manual entry is the one route that takes it from the client rather than
// measuring it. Unbounded it also back-dates start_time, which is derived
// from it.
const manual = source.split("router.post('/workouts/manual'")[1].split('router.')[0];
assert.match(manual, /Math\.min\(MAX_WORKOUT_DURATION_SEC,/, 'manual duration is clamped at the top');
assert.match(manual, /const cal = rawCal > 0 && rawCal <= MAX_WORKOUT_CALORIES/, 'manual calories are bounded');
assert.match(source, /LEADERBOARD_METRICS = new Set\(\['distance_km', 'duration_min', 'workouts'\]\)/,
  'if the ranked metrics change, revisit which submitted numbers need ceilings');

console.log('Workout distance: real distances kept, out-of-range and non-numeric rejected, shared surfaces read the validated value.');
