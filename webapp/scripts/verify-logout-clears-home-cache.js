'use strict';
// Member-scoped Home caches (feed + Scripture in Motion) must not survive
// sign-out into the next account on the same tab. Settings logout reloads the
// page (RAM dies). The setup-account sign-out path only cleared offline
// verses + state.me and left state.homeCache (incl. mission) intact.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

const setupSignout = app.match(/#setup-signout['"]\)\.onclick\s*=\s*async\s*\(\)\s*=>\s*\{([\s\S]*?)\};/);
assert.ok(setupSignout, 'could not find #setup-signout handler');
assert.match(setupSignout[1], /clearOfflineSavedVerses\s*\(/,
  'setup sign-out must clear private offline Scripture');
assert.match(setupSignout[1], /state\.homeCache\s*=\s*null/,
  'setup sign-out must null homeCache (feed + mission) before renderSignIn');
assert.match(setupSignout[1], /state\.me\s*=\s*null/,
  'setup sign-out must clear the signed-in member');

const settingsLogout = app.match(/fetch\(\s*'\/api\/auth\/logout'[\s\S]{0,400}?clearOfflineSavedVerses\s*\(\)[\s\S]{0,200}?location\.reload\s*\(\)/);
assert.ok(settingsLogout,
  'settings logout must clear offline verses and reload (or explicitly null homeCache)');

console.log('Logout clears homeCache: setup sign-out nulls member Home caches; settings logout still reloads.');
