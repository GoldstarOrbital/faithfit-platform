'use strict';
// Pins input ceilings that are still missing on main: workout partner fan-out,
// workout start activity type, and search query length. Unbounded partners /
// types / q strings are DoS and data-quality footguns on shared surfaces.
// Expected to FAIL on current main.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');

function handler(routeLiteral) {
  const rest = source.split(routeLiteral)[1];
  assert.ok(rest, `could not find ${routeLiteral}`);
  return rest.split('router.')[0];
}

// tagWorkoutPartners must slice the partner list (cap fan-out / notify storm).
const tagStart = source.indexOf('function tagWorkoutPartners');
assert.ok(tagStart >= 0, 'could not find tagWorkoutPartners');
const tagRest = source.slice(tagStart);
const tagEndMatch = tagRest.search(/\r?\n(?:function |router\.)/);
const tagFn = tagEndMatch > 0 ? tagRest.slice(0, tagEndMatch) : tagRest.slice(0, 2500);
assert.match(
  tagFn,
  /partnerUserIds[\s\S]{0,160}\.slice\s*\(\s*0\s*,\s*\d+\s*\)/,
  'tagWorkoutPartners must slice partners to a finite cap — current main iterates the raw array unbounded'
);

// POST /workouts/start must validate type via ACTIVITY_SET (and/or slice), like
// manual entry and Strava import already do.
const start = handler("router.post('/workouts/start'");
assert.match(
  start,
  /ACTIVITY_SET\.has\s*\(/,
  "POST /workouts/start must use ACTIVITY_SET.has(...) on type — current main inserts req.body.type verbatim"
);
assert.match(
  start,
  /ACTIVITY_SET\.has\s*\([^)]+\)\s*\?[\s\S]{0,80}:\s*['"]Workout['"]|\.slice\s*\(\s*0\s*,\s*\d+\s*\)/,
  'POST /workouts/start must slice or fall back the activity type to a known ACTIVITY_SET member'
);

// GET /search must cap/slice q.
const search = handler("router.get('/search'");
assert.match(
  search,
  /req\.query\.q[\s\S]{0,80}\.slice\s*\(\s*0\s*,\s*\d+\s*\)|String\(\s*req\.query\.q[\s\S]{0,60}\.slice\s*\(\s*0\s*,\s*\d+\s*\)/,
  'GET /search must cap/slice q — current main uses the raw query string unbounded'
);

// GET /bible/search must cap/slice q before FTS.
const bible = handler("router.get('/bible/search'");
assert.match(
  bible,
  /req\.query\.q[\s\S]{0,80}\.slice\s*\(\s*0\s*,\s*\d+\s*\)/,
  'GET /bible/search must cap/slice q before building the FTS query — current main only trims'
);

console.log('Input bounds (partners / workouts/start / search / bible/search): PASS');
