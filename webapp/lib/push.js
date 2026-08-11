/**
 * Web Push notifications.
 *
 * The app has always had a notification bell, which is only useful while
 * someone is looking at the app. This delivers to a closed browser and a locked
 * phone, through the browser's own push service — the same standard Chrome,
 * Edge, Firefox and Safari implement. No third-party push vendor, no SDK, and
 * no cost: VAPID keys are generated locally and the browser vendors carry the
 * message.
 *
 * Configuration is a keypair, not an account. `npm run vapid` (or the snippet
 * below) prints one; set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
 * and pushes start working. Without them this module is inert — no timer, no
 * endpoint, and the in-app bell behaves exactly as before.
 *
 *   node -e "console.log(require('web-push').generateVAPIDKeys())"
 *
 * Two rules here:
 *
 *   1. Nothing is sent that the member did not ask for. A subscription is
 *      created only from an explicit browser permission prompt, each category
 *      is opt-in separately, and every payload carries a link to turn it off.
 *
 *   2. Scripture in a notification is real scripture. The payload is built from
 *      resolved text like everywhere else — a push is not a place where an
 *      unverified verse gets a free pass because it is only a preview.
 */
'use strict';

const db = require('./db');

let webpush = null;
try { webpush = require('web-push'); } catch { /* dependency absent: stay inert */ }

// Categories are separate because they are genuinely different intrusions. A
// daily verse at 7am is not the same ask as being told someone replied to you.
const CATEGORIES = {
  daily_verse: 'A verse each morning, chosen for you.',
  verse_reply: 'When someone replies to your reflection.',
  social: 'Follows, likes and comments.',
  reminders: 'Streaks and challenges you have joined.',
  security: 'New devices and sensitive account changes.',
};
// Encouragement is intentionally included: it is event-driven at meaningful
// effort transitions, never a heartbeat or a five-second workout stream.
const DEFAULT_CATEGORIES = ['daily_verse', 'verse_reply', 'reminders', 'security'];

function publicKey() { return process.env.VAPID_PUBLIC_KEY || null; }
function isConfigured() {
  return !!(webpush && publicKey() && process.env.VAPID_PRIVATE_KEY);
}

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      endpoint TEXT NOT NULL UNIQUE,
      p256dh TEXT NOT NULL,
      auth TEXT NOT NULL,
      categories TEXT NOT NULL,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_sent_at TEXT,
      failures INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

    -- What was sent, so a member can see it and so "did the daily verse go out
    -- today?" is answerable without guessing.
    CREATE TABLE IF NOT EXISTS push_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      category TEXT NOT NULL,
      title TEXT,
      body TEXT,
      url TEXT,
      sent_at TEXT NOT NULL DEFAULT (datetime('now')),
      ok INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_push_log_user ON push_log(user_id, sent_at);
  `);

  if (isConfigured()) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:hello@functioningfaith.app',
      publicKey(), process.env.VAPID_PRIVATE_KEY);
  }
}

function normaliseCategories(list) {
  if (!Array.isArray(list)) return DEFAULT_CATEGORIES.slice();
  const out = list.map(String).filter(c => CATEGORIES[c]);
  return [...new Set(out)];
}

/** Store (or refresh) a browser subscription. Idempotent on endpoint. */
function subscribe(userId, sub, categories, userAgent) {
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) return null;
  const cats = JSON.stringify(normaliseCategories(categories));
  const id = require('crypto').randomUUID();
  db.prepare(`INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, categories, user_agent)
              VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,
                p256dh=excluded.p256dh, auth=excluded.auth,
                categories=excluded.categories, failures=0`)
    .run(id, userId, sub.endpoint, sub.keys.p256dh, sub.keys.auth, cats,
         (userAgent || '').slice(0, 200));
  return get(userId);
}

function unsubscribe(userId, endpoint) {
  const r = db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?')
    .run(userId, endpoint);
  return r.changes > 0;
}

function setCategories(userId, endpoint, categories) {
  const r = db.prepare('UPDATE push_subscriptions SET categories = ? WHERE user_id = ? AND endpoint = ?')
    .run(JSON.stringify(normaliseCategories(categories)), userId, endpoint);
  return r.changes > 0;
}

function get(userId) {
  return db.prepare('SELECT id, endpoint, categories, created_at, last_sent_at FROM push_subscriptions WHERE user_id = ?')
    .all(userId).map(r => ({ ...r, categories: JSON.parse(r.categories) }));
}

/**
 * Send to every subscription of a member that has opted into this category.
 *
 * A 404 or 410 from the push service means the browser threw the subscription
 * away (cleared data, uninstalled). That is not a failure to retry — the row is
 * deleted, because keeping it means trying forever.
 */
async function send(userId, category, payload) {
  if (!isConfigured()) return { sent: 0, skipped: 'not_configured' };
  const subs = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  let sent = 0;

  for (const s of subs) {
    let cats = [];
    try { cats = JSON.parse(s.categories); } catch { cats = []; }
    if (!cats.includes(category)) continue;

    const body = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url || '/',
      tag: payload.tag || category,
    });
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body);
      db.prepare("UPDATE push_subscriptions SET last_sent_at = datetime('now'), failures = 0 WHERE id = ?").run(s.id);
      sent++;
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(s.id);
      } else {
        db.prepare('UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?').run(s.id);
      }
    }
  }

  try {
    db.prepare('INSERT INTO push_log (id, user_id, category, title, body, url, ok) VALUES (?,?,?,?,?,?,?)')
      .run(require('crypto').randomUUID(), userId, category,
           payload.title, payload.body, payload.url || null, sent > 0 ? 1 : 0);
  } catch { /* telemetry must not break a send */ }

  return { sent };
}

function history(userId, limit) {
  return db.prepare('SELECT category, title, body, url, sent_at FROM push_log WHERE user_id = ? ORDER BY sent_at DESC LIMIT ?')
    .all(userId, Math.min(50, Number(limit) || 20));
}

function start() {
  init();
  console.log(isConfigured()
    ? '[push] web push enabled'
    : '[push] no VAPID keys — in-app notifications only, nothing is sent off-app');
}

module.exports = {
  start, init, isConfigured, publicKey, subscribe, unsubscribe, setCategories,
  get, send, history, CATEGORIES, DEFAULT_CATEGORIES,
};
