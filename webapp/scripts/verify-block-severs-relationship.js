'use strict';
// Blocking has to actually end the relationship, not just filter what each
// person can read. Apple's UGC guidelines expect a block to work, and the
// failure this pins is the one that matters most: a blocked member being able
// to put their own display name back in front of the person who blocked them.
//
// Runs the real dms.block() against a throwaway database rather than asserting
// on source text, so a change that keeps the wording but drops a DELETE fails.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-block-'));
// lib/db creates the real followers / follow_requests / circle_members schema
// on require, so this runs against the production tables, not a simplified
// stand-in that could drift from them.
const db = require('../lib/db');
const dms = require('../lib/dms');
const circle = require('../lib/circle');
dms.init();
circle.init();

const A = 'blocker', B = 'blocked';
const follows = db.prepare('INSERT OR IGNORE INTO followers (follower_id, followee_id) VALUES (?,?)');
const requests = db.prepare('INSERT OR IGNORE INTO follow_requests (requester_id, target_id) VALUES (?,?)');
const circles = db.prepare('INSERT OR IGNORE INTO circle_members (owner_id, member_id) VALUES (?,?)');
const seed = () => {
  db.exec('DELETE FROM followers; DELETE FROM follow_requests; DELETE FROM circle_members; DELETE FROM dm_blocks;');
  follows.run(A, B); follows.run(B, A);
  circles.run(A, B); circles.run(B, A);
};
const count = (table, sql, ...args) => db.prepare(`SELECT COUNT(*) c FROM ${table} ${sql}`).get(...args).c;
const between = (table, a, b) => table === 'followers'
  ? count(table, 'WHERE (follower_id=? AND followee_id=?) OR (follower_id=? AND followee_id=?)', a, b, b, a)
  : table === 'follow_requests'
    ? count(table, 'WHERE (requester_id=? AND target_id=?) OR (requester_id=? AND target_id=?)', a, b, b, a)
    : count(table, 'WHERE (owner_id=? AND member_id=?) OR (owner_id=? AND member_id=?)', a, b, b, a);

// A mutual follow, mutual circle membership, and a pending request all end.
seed();
requests.run(B, A);
assert.equal(between('followers', A, B), 2, 'seeded both directions');
assert.deepEqual(dms.block(A, B), { ok: true, blocked: true });
assert.equal(between('followers', A, B), 0, 'a block ends the follow in both directions');
assert.equal(between('follow_requests', A, B), 0,
  'a pending request must not keep sitting in the blocker list with the blocked name on it');
assert.equal(between('circle_members', A, B), 0,
  'circle is a subset of followers and gates the most sensitive posts -- it must not outlive the block');
assert.ok(dms.isBlockedEitherWay(A, B) && dms.isBlockedEitherWay(B, A), 'blocked in both directions');

// The request the OTHER way around is cleared too: whoever presses block, the
// pending relationship between them ends.
seed();
requests.run(A, B);
dms.block(B, A);
assert.equal(between('follow_requests', A, B), 0, 'either party blocking clears a pending request');
assert.equal(between('followers', A, B), 0, 'either party blocking ends the follow');

// Only that pair is touched.
seed();
follows.run(A, "bystander");
circles.run(A, "bystander");
dms.block(A, B);
assert.equal(count('followers', "WHERE followee_id='bystander'"), 1, 'unrelated follows survive');
assert.equal(count('circle_members', "WHERE member_id='bystander'"), 1, 'unrelated circle members survive');

// Blocking yourself, or nobody, is still rejected before anything is deleted.
seed();
assert.deepEqual(dms.block(A, A), { error: 'invalid_recipient' });
assert.deepEqual(dms.block(A, null), { error: 'invalid_recipient' });
assert.equal(between('followers', A, B), 2, 'a rejected block deletes nothing');

const source = fs.readFileSync(path.join(__dirname, '../routes/api.js'), 'utf8');

// Verse threads were the one social surface with no block handling at all --
// the feed and post comments both drop authors on either side of a block.
// Runs the real reflectionRows SQL, not a copy.
const reflectionSql = source
  .split('function reflectionRows')[1]
  .match(/db\.prepare\(`([\s\S]*?)`\)/)[1];
db.exec("DELETE FROM verse_reflections; DELETE FROM users; DELETE FROM dm_blocks;");
const addUser = db.prepare('INSERT INTO users (id, display_name, email) VALUES (?,?,?)');
for (const [id, name] of [[A, 'Blocker'], [B, 'Blocked'], ['third', 'Third']]) addUser.run(id, name, `${id}@test.invalid`);
db.prepare('INSERT INTO verse_reflections (id, thread_id, user_id, content) VALUES (?,?,?,?),(?,?,?,?)')
  .run('r-a', 't1', A, 'mine', 'r-b', 't1', B, 'theirs');
const reflections = (me) => db.prepare(reflectionSql).all({ thread: 't1', me }).map(r => r.user_id);

assert.deepEqual(reflections(A).sort(), [A, B].sort(), 'both visible before any block');
dms.block(A, B);
assert.deepEqual(reflections(A), [A], 'the blocked member\'s reflection is hidden from the blocker');
assert.deepEqual(reflections(B), [B], 'and the blocker\'s is hidden from them, both directions');
assert.deepEqual(reflections('third').sort(), [A, B].sort(), 'an uninvolved reader still sees the whole thread');
assert.deepEqual(reflections(null).sort(), [A, B].sort(), 'a signed-out reader is unaffected');

// The reflection itself still posts across a block -- a shared scripture
// thread is not one member's to close -- but the notification, which carries
// the sender's name and their own text, must not cross it.
const reflect = source.split("router.post('/verses/threads/:id/reflections'")[1].split('router.')[0];
assert.match(reflect, /const blocked = \(userId\) => dms\.isBlockedEitherWay\(me, userId\)/, 'reflection notices check blocking');
assert.equal((reflect.match(/if \(!blocked\(/g) || []).length, 2,
  'both the parent-author and thread-opener notices are guarded');
assert.match(source.split("router.post('/verses/reflections/:id/like'")[1].split('router.')[0],
  /if \(dms\.isBlockedEitherWay\(uid, reflection\.user_id\)\) return res\.status\(404\)/,
  'liking a reflection refuses a blocked pair, the way /posts/:id/like does');

// Directed interactions that notify one person by name, inside a shared space.
assert.match(source.split("router.post('/groups/:id/pulse/:checkinId/encourage'")[1].split('router.')[0],
  /if \(dms\.isBlockedEitherWay\(req\.session\.userId, checkin\.user_id\)\)/,
  'group pulse encouragement does not cross a block');
assert.match(source.split("router.post('/events/:id/rsvp'")[1].split('router.')[0],
  /&& !dms\.isBlockedEitherWay\(req\.session\.userId, event\.creator_id\)/,
  'an RSVP does not notify an organiser who blocked the member');

// Following is the one write path that could put a blocked name back in front
// of the blocker. It must refuse, with the same 404 every other blocked read
// gives, so it cannot be used to probe whether someone blocked you.
const follow = source.split("router.post('/users/:id/follow'")[1].split('router.')[0];
assert.match(follow, /if \(dms\.isBlockedEitherWay\(me, target\)\) return res\.status\(404\)/,
  'the follow route must refuse a blocked pair');
assert.ok(follow.indexOf('isBlockedEitherWay') < follow.indexOf('INSERT OR IGNORE INTO followers'),
  'the block check must come before the follower row is written');
assert.ok(follow.indexOf('isBlockedEitherWay') < follow.indexOf('follow_request'),
  'and before a follow request can notify the blocker');

// Best effort: Windows keeps the SQLite file handle open until exit, so the
// temp directory cannot always be removed here. It is a temp directory.
try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch {}
console.log('Blocking: follows, pending requests and circle membership all end, both directions, and a blocked member cannot follow back in.');
