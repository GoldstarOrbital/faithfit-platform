#!/usr/bin/env node
'use strict';

// A lightweight release gate for the native tab actions. It deliberately checks
// the server route and the Swift caller together, so a renamed API cannot leave
// a visible native control timing out against a missing endpoint.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const api = read('routes', 'api.js');
const client = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Networking', 'APIClient.swift');
const sensors = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Networking', 'BluetoothHeartRateManager.swift');
const workout = read('..', 'ios', 'FunctioningFaith', 'FunctioningFaith', 'Views', 'WorkoutView.swift');

assert.match(client, /request\.timeoutInterval = 20/, 'native taps need a finite network deadline');
for (const route of ['/feed', '/explore', '/dms', '/notifications', '/journeys', '/groups/nearby', '/workouts/start', '/workouts/:id/stop']) {
  assert.match(api, new RegExp(`router\\.(?:get|post|put|patch|delete)\\('${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), `missing server route ${route}`);
}
assert.match(sensors, /CBUUID\(string: "1816"\)/, 'cycling cadence service must be supported');
assert.match(sensors, /CBUUID\(string: "1818"\)/, 'cycling power service must be supported');
assert.match(sensors, /CBUUID\(string: "1826"\)/, 'fitness machine service must be supported');
assert.match(sensors, /parseCyclingSpeedCadence/, 'cadence data must be decoded');
assert.match(sensors, /parseCyclingPower/, 'power data must be decoded');
assert.match(workout, /"cadence_rpm"/, 'workout completion must retain cadence');
assert.match(workout, /"peak_power_w"/, 'workout completion must retain peak power');
assert.match(api, /'cadence_rpm', 'power_w', 'peak_power_w'/, 'server must validate sensor metrics');

console.log(JSON.stringify({ native_action_contracts: true, timeout_boundary_seconds: 20, bluetooth_profiles: ['heart_rate', 'cycling_speed_cadence', 'cycling_power', 'fitness_machine'] }));
