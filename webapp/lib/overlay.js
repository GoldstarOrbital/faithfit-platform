/**
 * Creator overlay.
 *
 * A browser source a streamer drops into OBS. Their live journey — distance,
 * pace, heart-rate zone, and the scripture that arrived at that physiological
 * moment — renders over their stream, so an audience sees Scripture turn up in
 * the middle of real effort rather than as a graphic somebody pasted on.
 *
 * Two design constraints shape this file:
 *
 *  1. OBS cannot log in. The overlay is reached with a capability token in the
 *     URL, so the token must be revocable and must unlock as little as possible.
 *     The public read returns a deliberately narrow projection — display name,
 *     route, the live figures and the current verse. Never an email, never an
 *     id that addresses anything else in the API.
 *
 *  2. A stream overlay showing stale numbers is worse than one showing none.
 *     State carries the moment it was written and the reader decides whether it
 *     is still live, rather than presenting a five-minute-old speed as current.
 */
'use strict';

const { randomBytes } = require('crypto');
const db = require('./db');

// Beyond this, a session is treated as over rather than merely quiet.
const STALE_MS = 25000;

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS overlay_tokens (
      user_id TEXT PRIMARY KEY,
      token TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_overlay_token ON overlay_tokens(token);

    CREATE TABLE IF NOT EXISTS overlay_state (
      user_id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

function tokenFor(userId) {
  const row = db.prepare('SELECT token, created_at FROM overlay_tokens WHERE user_id = ?').get(userId);
  return row || null;
}

/** Create the token, or replace it — rotating invalidates any URL already shared. */
function issueToken(userId) {
  const token = randomBytes(18).toString('hex');
  db.prepare(`INSERT INTO overlay_tokens (user_id, token) VALUES (?, ?)
              ON CONFLICT(user_id) DO UPDATE SET token = excluded.token, created_at = datetime('now')`)
    .run(userId, token);
  return tokenFor(userId);
}

function revokeToken(userId) {
  db.prepare('DELETE FROM overlay_tokens WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM overlay_state WHERE user_id = ?').run(userId);
  return { ok: true };
}

/**
 * Store what the overlay should show. Only the fields the overlay renders are
 * kept — this is not a general telemetry sink.
 */
function putState(userId, body) {
  const b = body || {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

  const payload = {
    journey_name: b.journey_name ? String(b.journey_name).slice(0, 80) : null,
    journey_world: b.journey_world ? String(b.journey_world).slice(0, 20) : null,
    distance_km: num(b.distance_km),
    total_km: num(b.total_km),
    percent: num(b.percent),
    speed_kmh: num(b.speed_kmh),
    elapsed_sec: num(b.elapsed_sec),
    // Heart data is carried only when the client says it was measured, so an
    // overlay can never broadcast a zone that nothing actually recorded.
    hr: b.hr_measured ? num(b.hr) : null,
    zone: b.hr_measured ? num(b.zone) : null,
    moment_label: b.moment_label ? String(b.moment_label).slice(0, 40) : null,
    moment_measured: !!b.moment_measured,
    verse_reference: b.verse_reference ? String(b.verse_reference).slice(0, 60) : null,
    verse_text: b.verse_text ? String(b.verse_text).slice(0, 400) : null,
    next_waypoint: b.next_waypoint ? String(b.next_waypoint).slice(0, 80) : null,
    riding: !!b.riding,
  };

  db.prepare(`INSERT INTO overlay_state (user_id, payload, updated_at) VALUES (?, ?, ?)
              ON CONFLICT(user_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`)
    .run(userId, JSON.stringify(payload), Date.now());
  return { ok: true };
}

/**
 * The public projection behind a token. Deliberately narrow: enough to render a
 * stream overlay and nothing that identifies or addresses the account.
 */
function readByToken(token) {
  const t = db.prepare('SELECT user_id FROM overlay_tokens WHERE token = ?').get(String(token || ''));
  if (!t) return null;

  const user = db.prepare('SELECT display_name FROM users WHERE id = ?').get(t.user_id) || {};
  const row = db.prepare('SELECT payload, updated_at FROM overlay_state WHERE user_id = ?').get(t.user_id);
  if (!row) return { display_name: user.display_name || null, live: false, state: null };

  let payload = null;
  try { payload = JSON.parse(row.payload); } catch { payload = null; }
  const live = Date.now() - Number(row.updated_at) < STALE_MS;

  return {
    display_name: user.display_name || null,
    live,                                  // the overlay hides itself when false
    age_ms: Date.now() - Number(row.updated_at),
    state: payload,
  };
}

module.exports = { init, tokenFor, issueToken, revokeToken, putState, readByToken, STALE_MS };
