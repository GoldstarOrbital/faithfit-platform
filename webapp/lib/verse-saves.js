'use strict';

// A member's saved Scripture is private. Store the verified text alongside the
// canonical reference so a saved collection remains useful even when a later
// YouVersion request is unavailable. Nothing here makes a collection public.
const { randomUUID } = require('crypto');
const db = require('./db');

db.exec(`
  CREATE TABLE IF NOT EXISTS saved_verses (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    reference TEXT NOT NULL,
    book TEXT NOT NULL,
    chapter INTEGER NOT NULL,
    verse INTEGER NOT NULL,
    text TEXT NOT NULL,
    translation TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, reference)
  );
  CREATE INDEX IF NOT EXISTS idx_saved_verses_user_created ON saved_verses(user_id, created_at DESC);
`);

function canonical(row) { return `${row.book} ${row.chapter}:${row.verse}`; }

function toggle(userId, row) {
  const reference = canonical(row);
  const existing = db.prepare('SELECT id FROM saved_verses WHERE user_id = ? AND reference = ?').get(userId, reference);
  if (existing) {
    db.prepare('DELETE FROM saved_verses WHERE id = ? AND user_id = ?').run(existing.id, userId);
    return { saved: false, reference };
  }
  db.prepare(`INSERT INTO saved_verses (id, user_id, reference, book, chapter, verse, text, translation)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), userId, reference, row.book, Number(row.chapter), Number(row.verse), row.text, row.translation || null);
  return { saved: true, reference };
}

function list(userId, limit = 200) {
  return db.prepare(`SELECT id, reference, book, chapter, verse, text, translation, created_at
                       FROM saved_verses WHERE user_id = ?
                      ORDER BY created_at DESC LIMIT ?`).all(userId, Math.max(1, Math.min(200, Number(limit) || 200)));
}

module.exports = { toggle, list };
