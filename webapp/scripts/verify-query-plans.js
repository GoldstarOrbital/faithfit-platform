'use strict';
// The busiest tables in this schema had no indexes at all. Everything built
// recently acquired them as it went; posts, post_likes, post_comments,
// followers, notifications and workouts predate that habit, so the feed was
// planned as SCAN posts plus USE TEMP B-TREE FOR ORDER BY -- every feed load
// reading every post ever written and sorting them in memory -- and the unread
// badge on every Home load was a full scan of notifications.
//
// Measured at 100,000 rows before adding them: feed 9.18ms, unread badge
// 4.47ms per query, against 0.02ms and 0.00ms after. That is 569x and 1126x,
// and it is per request on a single-threaded server, so it serialises.
//
// This asserts the plans, not the timings. A plan is deterministic; a timing on
// CI is not. Any of these falling back to a scan is the regression to catch.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-plans-'));
const db = require('../lib/db');

// Access paths that must never be a table scan. Each is on the critical path of
// a screen a member opens constantly.
const REQUIRED = [
  ['the feed, ordered and cursor-paginated',
    'SELECT p.id FROM posts p WHERE p.created_at < ? ORDER BY p.created_at DESC LIMIT 20', ['2030-01-01']],
  ['a member\'s own posts',
    'SELECT id FROM posts WHERE user_id=? ORDER BY created_at DESC LIMIT 20', ['u']],
  ['the unread badge, on every Home load',
    'SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0', ['u']],
  ['the notification list',
    'SELECT id FROM notifications WHERE user_id=? ORDER BY delivered_at DESC LIMIT 30', ['u']],
  ['who follows a member (the reverse of the primary key)',
    'SELECT follower_id FROM followers WHERE followee_id=?', ['u']],
  ['what a member has liked (also the reverse of the primary key)',
    'SELECT post_id FROM post_likes WHERE user_id=?', ['u']],
  ['comments on a post',
    'SELECT id FROM post_comments WHERE post_id=? ORDER BY created_at', ['p']],
  ['workout history',
    'SELECT id FROM workouts WHERE user_id=? ORDER BY start_time DESC LIMIT 20', ['u']],
];

const failures = [];
for (const [name, sql, args] of REQUIRED) {
  const plan = db.prepare('EXPLAIN QUERY PLAN ' + sql).all(...args).map(r => r.detail).join(' | ');
  // "SCAN <table>" with no USING clause is a full table scan. A temp B-tree for
  // ORDER BY means the whole result set is being sorted in memory, which is the
  // half of the feed problem that survives even a partly-indexed lookup.
  const scans = /SCAN (?!.*USING)/.test(plan);
  const sorts = /TEMP B-TREE/.test(plan);
  if (scans || sorts) failures.push(`${name}\n    ${plan}`);
}

assert.deepEqual(failures, [],
  'these must use an index -- a full scan or an in-memory sort here is felt on every request:\n  ' + failures.join('\n  '));

// The reverse-direction indexes are the easiest to lose, because the primary
// key makes the forward direction look covered and the plan only degrades for
// the other one.
const indexes = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL").all().map(r => r.name);
for (const required of ['idx_posts_created', 'idx_posts_user_created', 'idx_notifications_user_read',
                        'idx_followers_followee', 'idx_post_likes_user', 'idx_post_comments_post',
                        'idx_workouts_user_start']) {
  assert.ok(indexes.includes(required), `${required} is missing`);
}

try { fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true }); } catch {}
console.log(`Query plans: ${REQUIRED.length} hot paths all use an index, none sorts in memory.`);
