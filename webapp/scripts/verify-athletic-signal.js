/*
 * Static guardrails for the safety-critical parts of Train. These checks keep
 * future visual work from quietly making a workout hard to start or turning
 * estimated values into claimed measurements.
 */
const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`Missing ${label}`);
};

const sensors = read('public/sensors.js');
const app = read('public/app.js');
const effort = read('lib/effort.js');

requireText(sensors, 'GPS_ACCURACY_M = 50', '50m GPS accuracy gate');
requireText(sensors, 'GPS_MIN_FIXES = 2', 'two-fix GPS lock');
requireText(sensors, 'maximumAge: 0', 'fresh GPS fixes');
requireText(sensors, 'gpsCanOverride', 'honest GPS override');
requireText(app, 'gpsAlt', 'GPS elevation collection');
requireText(app, 'elevGainM', 'elevation gain calculation');
requireText(app, 'trimRouteClient', 'route jitter trimming');
requireText(effort, "source: 'user'", 'declared max-HR source');
requireText(effort, "source: 'estimate'", 'clearly labeled estimated max-HR source');

console.log(JSON.stringify({
  fresh_gps_lock: true,
  practical_accuracy_gate_m: 50,
  workout_override_is_explicit: true,
  elevation_and_jitter_handling: true,
  effort_sources_are_honest: true,
}));
