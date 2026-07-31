/**
 * Developer webhooks.
 *
 * Anyone building on Functioning Faith can register a live HTTPS endpoint and receive
 * their own account's domain events as they happen — the same events the
 * in-process bus already publishes (workout.completed, badge.awarded, journey
 * waypoints, and so on).
 *
 * Design notes:
 *  - Delivery is fire-and-forget with a short timeout. A slow or dead endpoint
 *    must never stall a workout save.
 *  - Every request is signed. The receiver verifies HMAC-SHA256 over
 *    "<timestamp>.<body>" using the secret shown once at creation time.
 *  - Endpoints are checked against private address space before every send.
 *    A webhook URL is attacker-controlled input, so it is a server-side request
 *    forgery vector if pointed at internal services.
 *  - An endpoint that fails repeatedly is switched off rather than retried
 *    forever. The owner can re-enable it once it is fixed.
 */
'use strict';

const { randomUUID, createHmac, randomBytes } = require('crypto');
const db = require('./db');
const { subscribe } = require('./events');

// Topics a developer may subscribe to. Anything not listed is never delivered,
// so adding an internal event to the bus cannot accidentally leak it.
const TOPICS = [
  'workout.started',
  'workout.completed',
  'badge.awarded',
  'quest.progress',
  'journey.waypoint',
  'segment.completed',
  'journey.completed',
  'user.followed',
  'verse.triggered',
];

const MAX_FAILURES = 20;   // consecutive failures before an endpoint is disabled
const TIMEOUT_MS = 5000;
const KEEP_DELIVERIES = 50; // per webhook, for the developer's own debugging

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT NOT NULL,
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_status INTEGER,
      last_error TEXT,
      last_delivered_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks(user_id);

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      webhook_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      ok INTEGER NOT NULL,
      status INTEGER,
      error TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_deliv ON webhook_deliveries(webhook_id, created_at DESC);
  `);
}

// --- URL safety ------------------------------------------------------------
// Private, loopback, link-local and carrier-grade-NAT space, plus IPv6 local
// ranges. A developer webhook is an outbound request made with our credentials
// and our network position; it must only ever reach the public internet.
function isPrivateHost(host) {
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;

  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, Number(v4[2]), Number(v4[3]), Number(v4[4])].some(n => n > 255)) return true;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;                 // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;       // CGNAT
    if (a >= 224) return true;                               // multicast / reserved
    return false;
  }

  if (h === '::1' || h === '::') return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true;             // unique local
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true;             // link-local
  return false;
}

function validateUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return { error: 'invalid_url' }; }
  if (u.protocol !== 'https:') return { error: 'https_required' };
  if (isPrivateHost(u.hostname)) return { error: 'private_address_not_allowed' };
  return { url: u.toString() };
}

function normaliseEvents(list) {
  if (!Array.isArray(list) || !list.length) return TOPICS.slice();
  const picked = list.map(String).filter(t => TOPICS.includes(t));
  return picked.length ? Array.from(new Set(picked)) : null;
}

// --- CRUD ------------------------------------------------------------------
function shape(row, opts) {
  return {
    id: row.id,
    url: row.url,
    events: JSON.parse(row.events),
    description: row.description || '',
    active: !!row.active,
    failure_count: row.failure_count,
    last_status: row.last_status,
    last_error: row.last_error,
    last_delivered_at: row.last_delivered_at,
    created_at: row.created_at,
    // The secret is returned exactly once, when the hook is created or rotated.
    ...(opts && opts.secret ? { secret: row.secret } : {}),
  };
}

function list(userId) {
  return db.prepare('SELECT * FROM webhooks WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId).map(r => shape(r));
}

function create(userId, { url, events, description }) {
  const checked = validateUrl(url);
  if (checked.error) return { error: checked.error };
  const picked = normaliseEvents(events);
  if (!picked) return { error: 'unknown_events' };
  const count = db.prepare('SELECT COUNT(*) c FROM webhooks WHERE user_id = ?').get(userId).c;
  if (count >= 10) return { error: 'too_many_webhooks' };

  const row = {
    id: randomUUID(),
    secret: 'whsec_' + randomBytes(24).toString('hex'),
  };
  db.prepare('INSERT INTO webhooks (id, user_id, url, secret, events, description) VALUES (?,?,?,?,?,?)')
    .run(row.id, userId, checked.url, row.secret, JSON.stringify(picked), String(description || '').slice(0, 200));
  const saved = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(row.id);
  return { webhook: shape(saved, { secret: true }) };
}

function update(userId, id, patch) {
  const row = db.prepare('SELECT * FROM webhooks WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return { error: 'not_found' };

  let url = row.url;
  if (patch.url != null) {
    const checked = validateUrl(patch.url);
    if (checked.error) return { error: checked.error };
    url = checked.url;
  }
  let events = row.events;
  if (patch.events != null) {
    const picked = normaliseEvents(patch.events);
    if (!picked) return { error: 'unknown_events' };
    events = JSON.stringify(picked);
  }
  const active = patch.active == null ? row.active : (patch.active ? 1 : 0);
  // Re-enabling is the developer saying "I fixed it", so the failure streak
  // resets — otherwise one stale count would disable it again immediately.
  const failures = (active && !row.active) ? 0 : row.failure_count;

  db.prepare(`UPDATE webhooks SET url=?, events=?, description=?, active=?, failure_count=?,
              last_error = CASE WHEN ?=0 THEN last_error ELSE NULL END WHERE id=?`)
    .run(url, events, patch.description == null ? row.description : String(patch.description).slice(0, 200),
         active, failures, failures, id);
  return { webhook: shape(db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id)) };
}

function rotate(userId, id) {
  const row = db.prepare('SELECT * FROM webhooks WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return { error: 'not_found' };
  const secret = 'whsec_' + randomBytes(24).toString('hex');
  db.prepare('UPDATE webhooks SET secret = ? WHERE id = ?').run(secret, id);
  return { webhook: shape(db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id), { secret: true }) };
}

function remove(userId, id) {
  const row = db.prepare('SELECT id FROM webhooks WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return { error: 'not_found' };
  db.prepare('DELETE FROM webhook_deliveries WHERE webhook_id = ?').run(id);
  db.prepare('DELETE FROM webhooks WHERE id = ?').run(id);
  return { ok: true };
}

function deliveries(userId, id) {
  const row = db.prepare('SELECT id FROM webhooks WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return null;
  return db.prepare('SELECT topic, ok, status, error, duration_ms, created_at FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT 25')
    .all(id).map(d => ({ ...d, ok: !!d.ok }));
}

// --- Delivery --------------------------------------------------------------
function sign(secret, timestamp, body) {
  return createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex');
}

function recordDelivery(hook, topic, result) {
  db.prepare('INSERT INTO webhook_deliveries (id, webhook_id, topic, ok, status, error, duration_ms) VALUES (?,?,?,?,?,?,?)')
    .run(randomUUID(), hook.id, topic, result.ok ? 1 : 0, result.status || null,
         result.error ? String(result.error).slice(0, 300) : null, result.duration_ms || null);

  if (result.ok) {
    db.prepare("UPDATE webhooks SET failure_count = 0, last_status = ?, last_error = NULL, last_delivered_at = datetime('now') WHERE id = ?")
      .run(result.status || 200, hook.id);
  } else {
    const failures = hook.failure_count + 1;
    db.prepare("UPDATE webhooks SET failure_count = ?, last_status = ?, last_error = ?, active = ?, last_delivered_at = datetime('now') WHERE id = ?")
      .run(failures, result.status || null, String(result.error || 'delivery_failed').slice(0, 300),
           failures >= MAX_FAILURES ? 0 : hook.active, hook.id);
  }

  // Trim the per-hook delivery log so a chatty account cannot grow the volume
  // without bound.
  db.prepare(`DELETE FROM webhook_deliveries WHERE webhook_id = ? AND id NOT IN
              (SELECT id FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?)`)
    .run(hook.id, hook.id, KEEP_DELIVERIES);
}

async function send(hook, topic, event) {
  // Re-validate on every send: a hook stored before a rule changed, or edited
  // to point somewhere new, must not get a free pass.
  const checked = validateUrl(hook.url);
  if (checked.error) { recordDelivery(hook, topic, { ok: false, error: checked.error }); return; }

  const body = JSON.stringify({ id: event.event_id, type: topic, created_at: event.occurred_at, data: event });
  const ts = String(Math.floor(Date.now() / 1000));
  const started = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(checked.url, {
      method: 'POST',
      signal: ac.signal,
      redirect: 'error', // a redirect could hop to private space after validation
      headers: {
        'content-type': 'application/json',
        'user-agent': 'Functioning Faith-Webhooks/1.0',
        'x-functioning-faith-event': topic,
        'x-functioning-faith-delivery': event.event_id,
        'x-functioning-faith-timestamp': ts,
        'x-functioning-faith-signature': 't=' + ts + ',v1=' + sign(hook.secret, ts, body),
      },
      body,
    });
    recordDelivery(hook, topic, {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      error: res.ok ? null : 'http_' + res.status,
      duration_ms: Date.now() - started,
    });
  } catch (e) {
    recordDelivery(hook, topic, {
      ok: false,
      error: e && e.name === 'AbortError' ? 'timeout' : (e && e.message) || 'network_error',
      duration_ms: Date.now() - started,
    });
  } finally {
    clearTimeout(timer);
  }
}

function dispatch(topic, event) {
  if (!TOPICS.includes(topic)) return;
  const userId = event && event.user_id;
  if (!userId) return;
  const hooks = db.prepare('SELECT * FROM webhooks WHERE user_id = ? AND active = 1').all(userId);
  for (const h of hooks) {
    let subscribed;
    try { subscribed = JSON.parse(h.events); } catch { subscribed = []; }
    if (!subscribed.includes(topic)) continue;
    // Never await: a developer's endpoint must not sit in the request path.
    send(h, topic, event).catch(() => {});
  }
}

function start() {
  init();
  subscribe('*', dispatch);
}

module.exports = { start, init, list, create, update, remove, rotate, deliveries, TOPICS, validateUrl, isPrivateHost, sign };
