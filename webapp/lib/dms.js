/**
 * Direct messages.
 *
 * One conversation per pair of people, so a thread cannot be duplicated by two
 * users opening it at once. The pair is stored in a fixed order and that order
 * is a unique key — which is what actually prevents the duplicate rather than
 * hoping the client checks first.
 *
 * Every read and write is authorised against membership. There is no endpoint
 * that takes a conversation id and trusts it; the caller must be one of the two
 * people in it, or the request is a 404 rather than a 403, so conversation ids
 * cannot be probed for existence.
 *
 * Blocking is honoured in both directions: if either person has blocked the
 * other, no new message can be sent either way.
 */
'use strict';

const { randomUUID } = require('crypto');
const db = require('./db');

// 4000 rather than 2000: an end-to-end encrypted body is base64(iv) + '.' +
// base64(ciphertext), which runs ~1.4x the plaintext length before overhead,
// so the old plaintext limit would silently truncate encrypted messages a
// user could type in full.
const MAX_LEN = 4000;

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dm_threads (
      id TEXT PRIMARY KEY,
      user_a TEXT NOT NULL,          -- always the lexicographically smaller id
      user_b TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_message_at TEXT,
      UNIQUE(user_a, user_b)
    );
    CREATE INDEX IF NOT EXISTS idx_dm_threads_a ON dm_threads(user_a, last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_dm_threads_b ON dm_threads(user_b, last_message_at DESC);

    CREATE TABLE IF NOT EXISTS dm_messages (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dm_messages_thread ON dm_messages(thread_id, created_at);

    CREATE TABLE IF NOT EXISTS dm_blocks (
      blocker_id TEXT NOT NULL,
      blocked_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (blocker_id, blocked_id)
    );
  `);
  // Additive migrations for installations created before rich DM cards.
  try { db.exec("ALTER TABLE dm_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'"); } catch {}
  try { db.exec("ALTER TABLE dm_messages ADD COLUMN metadata TEXT"); } catch {}
  try { db.exec("ALTER TABLE dm_messages ADD COLUMN edited_at TEXT"); } catch {}
  db.exec(`
    CREATE TABLE IF NOT EXISTS dm_message_likes (
      message_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (message_id, user_id)
    );
  `);
}

/** The canonical ordering that makes one pair mean one thread. */
function pair(x, y) {
  return x < y ? { a: x, b: y } : { a: y, b: x };
}

function isBlockedEitherWay(x, y) {
  return !!db.prepare(
    `SELECT 1 FROM dm_blocks WHERE (blocker_id = ? AND blocked_id = ?) OR (blocker_id = ? AND blocked_id = ?) LIMIT 1`
  ).get(x, y, y, x);
}

/**
 * The thread for two people, created if this is their first message.
 *
 * opts.bypassMessagePermission: for a verified coach reaching a publicly
 * listed, verified athlete -- see lib/coaches.js. It skips ONLY the
 * message_permission gate (the athlete already opted into being found for
 * recruiting, so a coach reaching out is the expected outcome of that, not
 * a privacy violation of it). It does NOT skip the minor-message-protection
 * check or a restrict control -- those are safety rules, not a privacy
 * preference, and recruiting visibility does not suspend them. The caller
 * is responsible for having actually confirmed coach verification and
 * athlete public-listing status before setting this; this function does
 * not check either.
 */
function openThread(me, otherId, opts = {}) {
  if (!otherId || otherId === me) return { error: 'invalid_recipient' };
  const other = db.prepare('SELECT id,display_name,message_permission,date_of_birth FROM users WHERE id=?').get(otherId);
  if (!other) return { error: 'no_such_user' };
  if (isBlockedEitherWay(me, otherId)) return { error: 'blocked' };

  const { a, b } = pair(me, otherId);
  let row = db.prepare('SELECT * FROM dm_threads WHERE user_a = ? AND user_b = ?').get(a, b);
  if (!row) {
    const connected = !!db.prepare(`SELECT 1 FROM followers WHERE
      (follower_id=? AND followee_id=?) OR (follower_id=? AND followee_id=?) LIMIT 1`).get(me,otherId,otherId,me);
    const mutual = !!db.prepare(`SELECT 1 WHERE EXISTS(SELECT 1 FROM followers WHERE follower_id=? AND followee_id=?)
      AND EXISTS(SELECT 1 FROM followers WHERE follower_id=? AND followee_id=?)`).get(me,otherId,otherId,me);
    const meDob = db.prepare('SELECT date_of_birth FROM users WHERE id=?').get(me)?.date_of_birth;
    const age = dob => { if(!dob) return null; const d=new Date(dob+'T00:00:00Z'),n=new Date(); let x=n.getUTCFullYear()-d.getUTCFullYear(); if(n.getUTCMonth()<d.getUTCMonth()||(n.getUTCMonth()===d.getUTCMonth()&&n.getUTCDate()<d.getUTCDate()))x--; return x; };
    const minor = [age(meDob), age(other.date_of_birth)].some(x => x != null && x < 18);
    if (!opts.bypassMessagePermission) {
      if (other.message_permission === 'nobody') return { error: 'messages_closed' };
      if (other.message_permission !== 'everyone' && !connected) return { error: 'message_permission' };
    }
    if (minor && !mutual) return { error: 'minor_message_protection' };
    if (db.prepare("SELECT 1 FROM account_relationship_controls WHERE actor_id=? AND subject_id=? AND control='restrict'").get(otherId,me)) return { error: 'restricted' };
    try {
      db.prepare('INSERT INTO dm_threads (id, user_a, user_b) VALUES (?, ?, ?)').run(randomUUID(), a, b);
    } catch (e) {
      // Two clients opening the same thread at once: the unique key wins and we
      // simply read back whichever insert landed.
      if (!/UNIQUE/i.test(e.message || '')) throw e;
    }
    row = db.prepare('SELECT * FROM dm_threads WHERE user_a = ? AND user_b = ?').get(a, b);
  }
  return { thread: row, other };
}

/** A thread the caller is actually in, or null. Membership is the authorisation. */
function threadFor(me, threadId) {
  return db.prepare(
    'SELECT * FROM dm_threads WHERE id = ? AND (user_a = ? OR user_b = ?)'
  ).get(threadId, me, me) || null;
}

function otherOf(thread, me) {
  return thread.user_a === me ? thread.user_b : thread.user_a;
}

/** The caller's inbox, most recent first, with unread counts. */
function inbox(me) {
  const rows = db.prepare(
    `SELECT t.*,
            (SELECT body FROM dm_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
            (SELECT kind FROM dm_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_kind,
            (SELECT sender_id FROM dm_messages m WHERE m.thread_id = t.id ORDER BY m.created_at DESC LIMIT 1) AS last_sender,
            (SELECT COUNT(*) FROM dm_messages m WHERE m.thread_id = t.id AND m.sender_id != ? AND m.read_at IS NULL) AS unread
     FROM dm_threads t
     WHERE (t.user_a = ? OR t.user_b = ?) AND t.last_message_at IS NOT NULL
     ORDER BY t.last_message_at DESC LIMIT 100`
  ).all(me, me, me);

  return rows.map(t => {
    const otherId = otherOf(t, me);
    const u = db.prepare('SELECT id, display_name, CASE WHEN avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar FROM users WHERE id = ?').get(otherId) || {};
    return {
      thread_id: t.id,
      user: { id: otherId, display_name: u.display_name || 'Someone', has_avatar: !!u.has_avatar },
      // The inbox preview is not worth deriving a shared key for on every
      // poll of every thread -- an encrypted thread just shows a generic
      // label here. The real content only ever gets decrypted once you open
      // the thread itself, in renderThread.
      last_body: t.last_kind === 'e2e' ? null : t.last_body,
      last_kind: t.last_kind,
      last_from_me: t.last_sender === me,
      last_message_at: t.last_message_at,
      unread: t.unread,
    };
  });
}

function totalUnread(me) {
  return db.prepare(
    `SELECT COUNT(*) AS c FROM dm_messages m
     JOIN dm_threads t ON t.id = m.thread_id
     WHERE (t.user_a = ? OR t.user_b = ?) AND m.sender_id != ? AND m.read_at IS NULL`
  ).get(me, me, me).c;
}

/** Messages in a thread, oldest first. Reading marks the other side's as read. */
function messages(me, threadId, limit = 200) {
  const t = threadFor(me, threadId);
  if (!t) return null;
  const rows = db.prepare(
    `SELECT m.id, m.sender_id, m.body, m.kind, m.metadata, m.created_at, m.read_at, m.edited_at,
            (SELECT COUNT(*) FROM dm_message_likes l WHERE l.message_id = m.id) AS like_count,
            EXISTS(SELECT 1 FROM dm_message_likes l WHERE l.message_id = m.id AND l.user_id = ?) AS liked_by_me
     FROM dm_messages m WHERE m.thread_id = ? ORDER BY m.created_at DESC LIMIT ?`
  ).all(me, threadId, Math.min(Number(limit) || 200, 500)).reverse();

  db.prepare("UPDATE dm_messages SET read_at = datetime('now') WHERE thread_id = ? AND sender_id != ? AND read_at IS NULL")
    .run(threadId, me);

  const otherId = otherOf(t, me);
  const u = db.prepare('SELECT id, display_name, CASE WHEN avatar_data IS NOT NULL THEN 1 ELSE 0 END AS has_avatar FROM users WHERE id = ?').get(otherId) || {};
  return {
    thread_id: threadId,
    user: { id: otherId, display_name: u.display_name || 'Someone', has_avatar: !!u.has_avatar },
    blocked: isBlockedEitherWay(me, otherId),
    messages: rows.map(m => ({
      id: m.id, body: m.body, kind: m.kind || 'text', metadata: m.metadata ? (() => { try { return JSON.parse(m.metadata); } catch { return null; } })() : null, from_me: m.sender_id === me,
      created_at: m.created_at, read: !!m.read_at, edited_at: m.edited_at || null,
      like_count: Number(m.like_count) || 0, liked_by_me: !!m.liked_by_me,
    })),
  };
}

/** Toggle the caller's like on a message in a thread they're actually in. */
function toggleLike(me, threadId, messageId) {
  const t = threadFor(me, threadId);
  if (!t) return { error: 'not_found' };
  const msg = db.prepare('SELECT id FROM dm_messages WHERE id = ? AND thread_id = ?').get(messageId, threadId);
  if (!msg) return { error: 'not_found' };

  const already = db.prepare('SELECT 1 FROM dm_message_likes WHERE message_id = ? AND user_id = ?').get(messageId, me);
  if (already) db.prepare('DELETE FROM dm_message_likes WHERE message_id = ? AND user_id = ?').run(messageId, me);
  else db.prepare('INSERT INTO dm_message_likes (message_id, user_id) VALUES (?, ?)').run(messageId, me);

  const count = db.prepare('SELECT COUNT(*) AS c FROM dm_message_likes WHERE message_id = ?').get(messageId).c;
  return { liked: !already, like_count: count };
}

/**
 * Edit a message's own text. Restricted to the sender, and to plain text --
 * an end-to-end message's body is ciphertext the server cannot meaningfully
 * "edit", and a verse card's body is a resolved scripture reference, not
 * free text someone should be retyping.
 */
function editMessage(me, threadId, messageId, body) {
  const t = threadFor(me, threadId);
  if (!t) return { error: 'not_found' };
  const msg = db.prepare('SELECT * FROM dm_messages WHERE id = ? AND thread_id = ?').get(messageId, threadId);
  if (!msg) return { error: 'not_found' };
  if (msg.sender_id !== me) return { error: 'not_your_message' };
  if (msg.kind !== 'text') return { error: 'not_editable' };

  const text = String(body == null ? '' : body).trim().slice(0, MAX_LEN);
  if (!text) return { error: 'empty_message' };

  db.prepare("UPDATE dm_messages SET body = ?, edited_at = datetime('now') WHERE id = ?").run(text, messageId);
  const row = db.prepare('SELECT id, body, kind, metadata, created_at, edited_at FROM dm_messages WHERE id = ?').get(messageId);
  const likeCount = db.prepare('SELECT COUNT(*) AS c FROM dm_message_likes WHERE message_id = ?').get(messageId).c;
  const likedByMe = !!db.prepare('SELECT 1 FROM dm_message_likes WHERE message_id = ? AND user_id = ?').get(messageId, me);
  return { message: { ...row, from_me: true, read: true, like_count: likeCount, liked_by_me: likedByMe } };
}

function send(me, threadId, body, options = {}) {
  const t = threadFor(me, threadId);
  if (!t) return { error: 'not_found' };
  const otherId = otherOf(t, me);
  if (isBlockedEitherWay(me, otherId)) return { error: 'blocked' };
  if (db.prepare("SELECT 1 FROM account_relationship_controls WHERE actor_id=? AND subject_id=? AND control='restrict'").get(otherId,me)) return { error:'restricted' };

  const text = String(body == null ? '' : body).trim().slice(0, MAX_LEN);
  if (!text) return { error: 'empty_message' };

  const id = randomUUID();
  db.prepare('INSERT INTO dm_messages (id, thread_id, sender_id, body, kind, metadata) VALUES (?,?,?,?,?,?)')
    .run(id, threadId, me, text, options.kind || 'text', options.metadata ? JSON.stringify(options.metadata) : null);
  db.prepare("UPDATE dm_threads SET last_message_at = datetime('now') WHERE id = ?").run(threadId);
  const row = db.prepare('SELECT id, body, kind, metadata, created_at, edited_at FROM dm_messages WHERE id = ?').get(id);
  if (row.metadata) { try { row.metadata = JSON.parse(row.metadata); } catch { row.metadata = null; } }
  return { message: { ...row, from_me: true, read: false, like_count: 0, liked_by_me: false }, recipient_id: otherId };
}

function block(me, otherId) {
  if (!otherId || otherId === me) return { error: 'invalid_recipient' };
  db.prepare('INSERT OR IGNORE INTO dm_blocks (blocker_id, blocked_id) VALUES (?, ?)').run(me, otherId);
  return { ok: true, blocked: true };
}

function unblock(me, otherId) {
  db.prepare('DELETE FROM dm_blocks WHERE blocker_id = ? AND blocked_id = ?').run(me, otherId);
  return { ok: true, blocked: isBlockedEitherWay(me, otherId) };
}

module.exports = {
  init, openThread, threadFor, inbox, messages, send, block, unblock,
  toggleLike, editMessage,
  totalUnread, isBlockedEitherWay, MAX_LEN,
};
