'use strict';

const { randomUUID } = require('crypto');
const db = require('./db');
const push = require('./push');

function sqlDate(date) {
  return new Date(date).toISOString().slice(0, 19).replace('T', ' ');
}

function init() {
  db.exec(`CREATE TABLE IF NOT EXISTS user_reminders (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
    scheduled_at TEXT NOT NULL, repeat_rule TEXT NOT NULL DEFAULT 'once', enabled INTEGER NOT NULL DEFAULT 1,
    last_sent_at TEXT, created_at TEXT DEFAULT (datetime('now'))
  ); CREATE INDEX IF NOT EXISTS idx_user_reminders_due ON user_reminders(enabled, scheduled_at);`);
}

function list(userId) {
  return db.prepare(`SELECT id, title, body, scheduled_at, repeat_rule, enabled, last_sent_at, created_at
    FROM user_reminders WHERE user_id = ? ORDER BY enabled DESC, scheduled_at ASC`).all(userId);
}

async function deliver(reminder) {
  const url = '/?open=reminder&reminder_id=' + encodeURIComponent(reminder.id);
  const payload = { message: reminder.body, title: reminder.title, body: reminder.body, url, reminder_id: reminder.id };
  db.prepare('INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), reminder.user_id, 'motivation', JSON.stringify(payload));
  await push.send(reminder.user_id, 'reminders', { title: reminder.title, body: reminder.body, url, tag: 'reminder:' + reminder.id });
}

async function runOnce() {
  const due = db.prepare(`SELECT * FROM user_reminders WHERE enabled = 1 AND scheduled_at <= datetime('now')`).all();
  let sent = 0;
  for (const reminder of due) {
    try {
      await deliver(reminder);
      sent++;
      if (reminder.repeat_rule === 'daily' || reminder.repeat_rule === 'weekly') {
        const next = new Date(String(reminder.scheduled_at).replace(' ', 'T') + 'Z');
        next.setUTCDate(next.getUTCDate() + (reminder.repeat_rule === 'weekly' ? 7 : 1));
        db.prepare("UPDATE user_reminders SET scheduled_at = ?, last_sent_at = datetime('now') WHERE id = ?")
          .run(sqlDate(next), reminder.id);
      } else {
        db.prepare("UPDATE user_reminders SET enabled = 0, last_sent_at = datetime('now') WHERE id = ?").run(reminder.id);
      }
    } catch (e) { console.error('[reminders] delivery failed:', e.message); }
  }
  return sent;
}

let timer = null;
function start() {
  init();
  timer = setInterval(() => runOnce().catch(() => {}), 30 * 1000);
  if (timer.unref) timer.unref();
  console.log('[reminders] timed motivation scheduler ready');
}

module.exports = { init, list, runOnce, start, sqlDate };
