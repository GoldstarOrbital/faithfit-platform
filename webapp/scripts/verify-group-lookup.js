#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

const api = read('routes', 'api.js');
const app = read('public', 'app.js');
const css = read('public', 'styles.css');

assert.match(app, /group-username-input/, 'Groups needs an in-app username finder');
assert.match(app, /\/groups\/username\/\$\{encodeURIComponent\(username\)\}/, 'finder must use the canonical username lookup');
assert.match(app, /replace\(\/\^@\+\//, 'finder must accept a copied @username');
assert.match(api, /group\.visibility === 'private' && !isGroupMember/, 'private groups must not be enumerated by username');
assert.match(api, /delete group\.visibility/, 'lookup must not leak group visibility metadata');
assert.match(css, /\.group-lookup-result/, 'found groups need a usable result card');

console.log(JSON.stringify({ group_username_finder: true, private_handle_protection: true }));
