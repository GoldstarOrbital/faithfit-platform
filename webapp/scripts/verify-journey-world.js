'use strict';

// Lightweight contract for the client-only Journey renderer. It catches a
// missing named theme (which otherwise fails only after Three.js is loaded) and
// ensures competitive visual cues remain driven by the recorded-ghost API.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const world = fs.readFileSync(path.join(__dirname, '..', 'public', 'journey3d.js'), 'utf8');
const live = fs.readFileSync(path.join(__dirname, '..', 'public', 'journey-live.js'), 'utf8');

for (const theme of ['fellowship', 'lantern']) {
  assert.match(world, new RegExp(`\\b${theme}\\s*:`), `${theme} route theme must be defined`);
}
assert.match(world, /setRaceIntensity\(value\)/, 'the renderer must expose a bounded race visual state');
assert.match(world, /const flags = \[-4\.4, 4\.4\]/, 'waypoints must have visible course markers');
assert.match(live, /\/journeys\/.*\/ghosts/, 'rivals must come from recorded journey ghosts');
assert.match(live, /world\.ghostDeltas\(total\)/, 'live gap display must use recorded ghost deltas');
assert.match(live, /OVERTAKE/, 'a real overtake needs a readable rider cue');
assert.match(live, /world\.setRaceIntensity\(1\)/, 'overtakes should give the renderer a transient response');

console.log(JSON.stringify({
  named_route_themes: true,
  waypoint_markers: true,
  recorded_ghost_competition: true,
  race_feedback: true,
}));
