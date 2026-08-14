#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const api = read('routes', 'api.js');
const app = read('public', 'app.js');
const css = read('public', 'styles.css');

assert.match(app, /ng-location-pin/, 'group creation needs an explicit location opt-in');
assert.match(app, /Math\.round\(pos\.coords\.latitude \* 100\) \/ 100/, 'group coordinates must be rounded to neighbourhood precision');
assert.match(app, /lat: groupPoint\?\.lat, lng: groupPoint\?\.lng/, 'the opted-in approximate point must reach group creation');
assert.match(api, /invalid_group_location/, 'invalid group coordinates must be rejected server-side');
assert.match(api, /groupLat < -90 \|\| groupLat > 90/, 'latitude bounds must be validated');
assert.match(api, /groupLng < -180 \|\| groupLng > 180/, 'longitude bounds must be validated');
assert.match(css, /\.group-location-optin/, 'the opt-in needs usable group form styling');

console.log(JSON.stringify({ approximate_group_location: true, coordinate_validation: true, location_discovery_enabled: true }));
