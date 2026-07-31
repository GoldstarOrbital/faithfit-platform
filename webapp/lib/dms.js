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

const MAX_LEN = 2000;

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

/** The thread for two people, created if this is their first message. */
function openThread(me, otherId) {
  if (!otherId || otherId === me) return { error: 'invalid_recipient' };
  const other = db.prepare('SELECT id, display_name FROM users WHERE id = ?').get(otherId);
  if (!other) return { error: 'no_such_user' };
  if (isBlockedEitherWay(me, otherId)) return { error: 'blocked' };

  const { a, b } = pair(me, otherId);
  let row = db.prepare('SELECT * FROM dm_threads WHERE user_a = ? AND user_b = ?').get(a, b);
  if (!row) {
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
      last_body: t.last_body,
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
    'SELECT id, sender_id, body, kind, metadata, created_at, read_at FROM dm_messages WHERE thread_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(threadId, Math.min(Number(limit) || 200, 500)).reverse();

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
      created_at: m.created_at, read: !!m.read_at,
    })),
  };
}

function send(me, threadId, body, options = {}) {
  const t = threadFor(me, threadId);
  if (!t) return { error: 'not_found' };
  const otherId = otherOf(t, me);
  if (isBlockedEitherWay(me, otherId)) return { error: 'blocked' };

  const text = String(body == null ? '' : body).trim().slice(0, MAX_LEN);
  if (!text) return { error: 'empty_message' };

  const id = randomUUID();
  db.prepare('INSERT INTO dm_messages (id, thread_id, sender_id, body, kind, metadata) VALUES (?,?,?,?,?,?)')
    .run(id, threadId, me, text, options.kind || 'text', options.metadata ? JSON.stringify(options.metadata) : null);
  db.prepare("UPDATE dm_threads SET last_message_at = datetime('now') WHERE id = ?").run(threadId);
  const row = db.prepare('SELECT id, body, kind, metadata, created_at FROM dm_messages WHERE id = ?').get(id);
  if (row.metadata) { try { row.metadata = JSON.parse(row.metadata); } catch { row.metadata = null; } }
  return { message: { ...row, from_me: true, read: false }, recipient_id: otherId };
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
  totalUnread, isBlockedEitherWay, MAX_LEN,
};
