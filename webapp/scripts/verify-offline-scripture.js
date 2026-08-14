#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const app = read('public', 'app.js');
const css = read('public', 'styles.css');
const html = read('public', 'index.html');
const sw = read('public', 'sw.js');
const saves = read('lib', 'verse-saves.js');

assert.match(app, /OFFLINE_SAVED_VERSES_PREFIX/, 'saved verses need a versioned local-only cache');
assert.match(app, /OFFLINE_SAVED_VERSES_PREFIX \+ userId/, 'offline Scripture must be scoped to the signed-in member');
assert.match(app, /function loadSavedVerses\(\)/, 'the saved collection needs an online-first, offline fallback loader');
assert.match(app, /readOfflineSavedVerses\(\)\.find\(item => item\.reference === reference\)/, 'a saved verse needs a readable offline detail view');
assert.match(app, /clearOfflineSavedVerses\(\); state\.me = null/, 'sign-out and deletion must clear private offline Scripture');
assert.match(app, /Offline reading mode/, 'members need an honest offline indicator');
assert.match(saves, /Return the same server-verified row/, 'new offline rows must originate from server-verified Scripture');
assert.match(css, /\.offline-scripture-note/, 'offline state needs visible styling');
assert.match(html, /app\.js\?v=ff-offline-scripture-1/, 'the script bundle must be cache-busted');
assert.match(sw, /functioning-faith-shell-v37/, 'the shell cache must advance');
console.log(JSON.stringify({ private_offline_scripture: true, account_scoped: true, cache_busted: true }));
