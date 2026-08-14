/**
 * Trusted circle — a named subset of your followers.
 *
 * The app had three audiences: public, followers, and private. For a faith
 * community that leaves the most important kind of post homeless. A prayer
 * request about a marriage, a relapse, a diagnosis, or a job loss is exactly
 * the content where "everyone who follows me" is far too wide and "only me"
 * defeats the purpose of asking. People either overshare it or -- much more
 * often -- say nothing at all.
 *
 * Instagram shipped Close Friends for the same reason. This is that, aimed at
 * the case it matters most for.
 *
 * SAFETY PROPERTY WORTH KNOWING: adding a fourth, MORE restrictive visibility
 * is safe to roll out incrementally because every existing visibility check in
 * this codebase matches positively -- postVisibleTo() ORs together
 * public/own/followers, and the inline SQL does the same. A post marked
 * 'circle' matches none of those branches, so any surface not yet taught about
 * circle posts simply does not show them. It fails closed. (This is the
 * opposite of the follow_requests situation, where a status column on
 * `followers` would have failed OPEN and silently granted access.)
 *
 * Membership is one-directional and silent: you choose who is in your circle,
 * they are never told, and being in someone's circle says nothing about
 * whether they are in yours.
 */
'use strict';

const db = require('./db');

const MAX_CIRCLE = 150; // past this it is not a trusted circle, it is an audience

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS circle_members (
      owner_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (owner_id, member_id)
    );
    CREATE INDEX IF NOT EXISTS idx_circle_owner ON circle_members(owner_id);
  `);
}

function isInCircle(ownerId, viewerId) {
  if (!ownerId || !viewerId) return false;
  return !!db.prepare('SELECT 1 FROM circle_members WHERE owner_id = ? AND member_id = ?').get(ownerId, viewerId);
}

function list(ownerId) {
  return db.prepare(`
    SELECT c.member_id user_id, c.created_at, u.display_name,
           CASE WHEN u.avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar
    FROM circle_members c JOIN users u ON u.id = c.member_id
    WHERE c.owner_id = ? ORDER BY u.display_name
  `).all(ownerId);
}

function count(ownerId) {
  return db.prepare('SELECT COUNT(*) c FROM circle_members WHERE owner_id = ?').get(ownerId).c;
}

/**
 * Add someone. Only a follower can be added: a circle is a narrowing of the
 * people who already see your followers-only posts, not a way to push private
 * content at someone who never chose to follow you.
 */
function add(ownerId, memberId) {
  if (!memberId || ownerId === memberId) return { error: 'invalid_member' };
  const follows = db.prepare('SELECT 1 FROM followers WHERE follower_id = ? AND followee_id = ?').get(memberId, ownerId);
  if (!follows) return { error: 'not_a_follower', hint: 'You can only add people who already follow you.' };
  if (count(ownerId) >= MAX_CIRCLE) return { error: 'circle_full', hint: `A trusted circle holds up to ${MAX_CIRCLE} people.` };
  db.prepare('INSERT OR IGNORE INTO circle_members (owner_id, member_id) VALUES (?, ?)').run(ownerId, memberId);
  return { ok: true };
}

function remove(ownerId, memberId) {
  const r = db.prepare('DELETE FROM circle_members WHERE owner_id = ? AND member_id = ?').run(ownerId, memberId);
  return { ok: true, removed: r.changes > 0 };
}

/** Someone who unfollows you should not keep seeing your circle posts. */
function pruneOnUnfollow(ownerId, exFollowerId) {
  db.prepare('DELETE FROM circle_members WHERE owner_id = ? AND member_id = ?').run(ownerId, exFollowerId);
}

module.exports = { init, isInCircle, list, count, add, remove, pruneOnUnfollow, MAX_CIRCLE };
