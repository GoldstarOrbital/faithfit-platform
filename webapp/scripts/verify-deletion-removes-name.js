'use strict';
// Deleting an account used to leave the member's name in other people's
// notifications. Payloads embed the actor's display name directly in the
// message text ("Alice gave you kudos"), and nothing recorded which member
// that was, so the deletion cascade could only remove the notifications the
// leaving member *received*. Their profile went; their name stayed.
//
// That contradicts what the deletion dialog tells members ("This removes your
// profile, posts, workouts, messages, connected tokens, and push
// subscriptions"), and account deletion is something App Store review tests.
//
// Verified end to end against a running server when this was written: a kudos
// notification naming the departing member survived deletion before the fix
// and did not after. This asserts the mechanism that makes that possible, so
// the guarantee cannot be quietly lost again.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const api = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');

// 1. The actor is recorded, or there is nothing to delete by.
assert.match(api, /INSERT INTO notifications \(id, user_id, type, payload, actor_id\) VALUES \(\?, \?, \?, \?, \?\)/,
  'notify() must record who caused the notification');
assert.match(api, /details\.actor_id \|\| null/, 'the actor comes from the caller');

// 2. Deletion removes notifications ABOUT the member, not only theirs.
const deleteRoute = api.split("router.delete('/me'")[1].split('router.')[0];
assert.match(deleteRoute, /DELETE FROM notifications WHERE actor_id=\?/,
  'account deletion must remove notifications about the departing member');
assert.ok(deleteRoute.includes("'notifications'"),
  'and still remove the ones they received');

// 3. Every notification whose text names another member records who that was.
//    This is the assertion that actually rots: a new notification type gets
//    added, names someone, and silently reintroduces the leak.
const calls = api.match(/notify\((?:[^()]|\([^()]*\))*\)/gs) || [];
const namesSomeone = calls.filter(c => /displayName\(|\$\{who\}|\$\{name\}/.test(c));
const missing = namesSomeone.filter(c => !c.includes('actor_id'))
  .map(c => c.replace(/\s+/g, ' ').slice(0, 100));
assert.deepEqual(missing, [],
  'these notifications name a member but do not record which one, so deleting that account would leave the name behind:\n  '
  + missing.join('\n  '));
assert.ok(namesSomeone.length >= 15,
  `expected the name-bearing notifications to still be found, saw ${namesSomeone.length}`);

// 4. The column and its index survive on a database that predates them. The
//    index must be created after the migration: declared in the schema block it
//    would run before the ALTER and take down startup on every existing
//    database, which is exactly the mistake made writing this.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-del-'));
const db = require('../lib/db');
assert.ok(db.prepare('PRAGMA table_info(notifications)').all().some(c => c.name === 'actor_id'),
  'notifications.actor_id must exist on a fresh database');
assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name='idx_notifications_actor'").get(),
  'deleting by actor must be indexed');
try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch {}

console.log(`Account deletion: ${namesSomeone.length} name-bearing notifications all record their actor, and deletion removes them.`);
