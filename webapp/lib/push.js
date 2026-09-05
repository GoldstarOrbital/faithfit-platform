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
const crypto = require('crypto');
const http2 = require('http2');

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
function isNativeConfigured() {
  return !!(process.env.APNS_KEY_ID && process.env.APPLE_TEAM_ID && process.env.APNS_AUTH_KEY);
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

    -- Native APNs/FCM device tokens, registered by the real native app or a
    -- future Android client. Kept in a separate table from push_subscriptions
    -- because a device token
    -- is not a Web Push subscription: it has no p256dh/auth keypair, and
    -- delivering to it needs a different transport entirely.
    --
    -- iOS delivery is active when APNS_AUTH_KEY, APNS_KEY_ID and APPLE_TEAM_ID
    -- are configured. Android remains intentionally inert until a Firebase
    -- service-account credential is added.
    CREATE TABLE IF NOT EXISTS native_push_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      platform TEXT NOT NULL CHECK (platform IN ('ios','android')),
      token TEXT NOT NULL,
      categories TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_sent_at TEXT,
      failures INTEGER NOT NULL DEFAULT 0,
      UNIQUE(platform, token)
    );
    CREATE INDEX IF NOT EXISTS idx_native_push_user ON native_push_tokens(user_id);
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
  const subs = isConfigured()
    ? db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId)
    : [];
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

  const native = await sendNative(userId, category, payload);
  sent += native.sent;

  try {
    db.prepare('INSERT INTO push_log (id, user_id, category, title, body, url, ok) VALUES (?,?,?,?,?,?,?)')
      .run(require('crypto').randomUUID(), userId, category,
           payload.title, payload.body, payload.url || null, sent > 0 ? 1 : 0);
  } catch { /* telemetry must not break a send */ }

  return { sent, native };
}

/** Store (or refresh) a native APNs/FCM device token. Idempotent on token. */
function registerNativeToken(userId, platform, token, categories) {
  if (!userId || !['ios', 'android'].includes(platform) || !token) return null;
  const cats = JSON.stringify(normaliseCategories(categories));
  const id = require('crypto').randomUUID();
  db.prepare(`INSERT INTO native_push_tokens (id, user_id, platform, token, categories)
              VALUES (?,?,?,?,?)
              ON CONFLICT(platform, token) DO UPDATE SET user_id = excluded.user_id,
                categories = excluded.categories, failures = 0`)
    .run(id, userId, platform, token, cats);
  return { registered: true };
}

function unregisterNativeToken(userId, token) {
  const r = db.prepare('DELETE FROM native_push_tokens WHERE user_id = ? AND token = ?').run(userId, token);
  return r.changes > 0;
}

let apnsJwt = null;
function base64url(input) { return Buffer.from(input).toString('base64url'); }
function apnsToken() {
  const now = Math.floor(Date.now() / 1000);
  if (apnsJwt && apnsJwt.expires > now + 30) return apnsJwt.value;
  const header = base64url(JSON.stringify({ alg: 'ES256', kid: process.env.APNS_KEY_ID }));
  const claims = base64url(JSON.stringify({ iss: process.env.APPLE_TEAM_ID, iat: now }));
  const signingInput = `${header}.${claims}`;
  const key = crypto.createPrivateKey(process.env.APNS_AUTH_KEY.replace(/\\n/g, '\n'));
  const signature = crypto.sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  apnsJwt = { value: `${signingInput}.${signature.toString('base64url')}`, expires: now + 50 * 60 };
  return apnsJwt.value;
}

/**
 * Translates the web client's destination URL (built by
 * notificationDestination() in routes/api.js as a query string this app's
 * own router reads, e.g. "/?open=dm&thread_id=abc") into the native app's
 * functioningfaith:// scheme, which DeepLinkRouter.swift's parser expects
 * as path segments instead (functioningfaith://dm/abc).
 *
 * Naively prepending the scheme to the web URL -- what this used to do --
 * produces functioningfaith://?open=dm&thread_id=abc: no host, no path, so
 * the native parser's `head` is empty and every single notification of
 * every type opened Home and nothing else, silently, with no error on
 * either side to reveal it. Every `open` value notificationDestination can
 * produce needs a matching case here, or that notification regresses to
 * the same silent Home fallback.
 */
function nativeDestination(url) {
  if (!url) return 'functioningfaith://home';
  if (/^functioningfaith:/i.test(url)) return url;
  if (/^https?:/i.test(url)) return url;

  let query;
  try { query = new URL(String(url), 'functioningfaith://placeholder').searchParams; }
  catch { return 'functioningfaith://home'; }

  const open = query.get('open');
  switch (open) {
    case 'dm': return query.get('thread_id')
      ? `functioningfaith://dm/${encodeURIComponent(query.get('thread_id'))}` : 'functioningfaith://messages';
    case 'post': return query.get('post_id')
      ? `functioningfaith://post/${encodeURIComponent(query.get('post_id'))}` : 'functioningfaith://home';
    case 'workout': return query.get('workout_id')
      ? `functioningfaith://workout/${encodeURIComponent(query.get('workout_id'))}` : 'functioningfaith://workouts';
    case 'group': return query.get('group_id')
      ? `functioningfaith://group/${encodeURIComponent(query.get('group_id'))}` : 'functioningfaith://explore';
    case 'verse': return query.get('ref')
      ? `functioningfaith://verse?ref=${encodeURIComponent(query.get('ref'))}` : 'functioningfaith://scripture';
    case 'profile': return 'functioningfaith://profile';
    // journeys, challenges, story, stats have no dedicated native deep-link
    // case (see DeepLinkRouter.swift) -- Explore is the closest existing
    // destination rather than the generic Home fallback every other unknown
    // case gets.
    case 'journeys': case 'challenges': case 'story': case 'stats':
      return 'functioningfaith://explore';
    case 'home': default:
      return 'functioningfaith://home';
  }
}

function apnsRequest(token, payload) {
  return new Promise((resolve, reject) => {
    const host = process.env.APNS_ENV === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
    const client = http2.connect(`https://${host}`);
    client.on('error', reject);
    const req = client.request({
      ':method': 'POST', ':path': `/3/device/${token}`,
      authorization: `bearer ${apnsToken()}`,
      'apns-topic': process.env.APNS_BUNDLE_ID || 'com.functioningfaith.app',
      'apns-push-type': 'alert', 'apns-priority': '10',
      'content-type': 'application/json',
    });
    let body = '';
    req.setEncoding('utf8');
    req.on('response', headers => {
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => { client.close(); resolve({ status: Number(headers[':status']), body }); });
    });
    req.on('error', err => { client.close(); reject(err); });
    req.end(JSON.stringify(payload));
  });
}

/** Send opted-in iOS notifications through APNs using Apple token auth. */
async function sendNative(userId, category, payload) {
  if (!isNativeConfigured()) return { sent: 0, skipped: 'not_configured' };
  const rows = db.prepare("SELECT * FROM native_push_tokens WHERE user_id = ? AND platform = 'ios'").all(userId);
  let sent = 0;
  for (const row of rows) {
    let categories = [];
    try { categories = JSON.parse(row.categories); } catch { /* invalid rows are ignored */ }
    if (!categories.includes(category)) continue;
    try {
      const result = await apnsRequest(row.token, {
        aps: { alert: { title: payload.title, body: payload.body }, sound: 'default', badge: 1 },
        ff_url: nativeDestination(payload.url),
      });
      if (result.status === 200) {
        db.prepare("UPDATE native_push_tokens SET last_sent_at = datetime('now'), failures = 0 WHERE id = ?").run(row.id);
        sent++;
      } else if (result.status === 400 || result.status === 410) {
        db.prepare('DELETE FROM native_push_tokens WHERE id = ?').run(row.id);
      } else {
        db.prepare('UPDATE native_push_tokens SET failures = failures + 1 WHERE id = ?').run(row.id);
      }
    } catch {
      db.prepare('UPDATE native_push_tokens SET failures = failures + 1 WHERE id = ?').run(row.id);
    }
  }
  return { sent };
}

function history(userId, limit) {
  return db.prepare('SELECT category, title, body, url, sent_at FROM push_log WHERE user_id = ? ORDER BY sent_at DESC LIMIT ?')
    .all(userId, Math.min(50, Number(limit) || 20));
}

function start() {
  init();
  console.log(`[push] web=${isConfigured() ? 'enabled' : 'off'} ios=${isNativeConfigured() ? 'enabled' : 'off'}`);
}

module.exports = {
  start, init, isConfigured, isNativeConfigured, publicKey, subscribe, unsubscribe, setCategories,
  get, send, history, CATEGORIES, DEFAULT_CATEGORIES,
  registerNativeToken, unregisterNativeToken, sendNative,
};
