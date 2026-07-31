/**
 * API keys for the public developer API.
 *
 * The app already lets developers receive events (lib/webhooks.js). This is the
 * other direction: letting them ask. A key is issued to a member, carries
 * scopes, and is rate limited.
 *
 * Keys are stored as SHA-256 hashes, never in plaintext. The full key is shown
 * exactly once, at creation, and cannot be recovered afterwards — only rotated.
 * The same reasoning as a password: a database read should not hand someone
 * else's credentials to whoever performed it.
 *
 * The visible prefix (`ff_live_a1b2c3d4`) is stored alongside so a developer can
 * tell their keys apart in a list without us keeping the secret half.
 */
'use strict';

const crypto = require('crypto');
const db = require('./db');

const PREFIX = 'ff_live_';

// Scopes are coarse on purpose. A finer-grained set nobody understands gets
// granted wholesale, which is worse than three honest ones.
const SCOPES = {
  'scripture:read': 'Look up verified scripture text, translations and the canon index.',
  'moment:read': 'Turn workout or rest telemetry into a fitting verse.',
  'breathwork:read': 'Guided breathing patterns and their scripture.',
};
const DEFAULT_SCOPES = Object.keys(SCOPES);

// Per-key, per-hour. Generous for real use, low enough that a runaway loop
// stops before it costs anything — the moment endpoint reaches Gloo, which is
// metered.
const RATE_LIMIT_PER_HOUR = 1000;
const MOMENT_LIMIT_PER_HOUR = 120;

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT,
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      scopes TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_used_at TEXT,
      revoked_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

    -- One row per key per hour per bucket. Cheap to write, trivial to read,
    -- and self-pruning because old rows are deleted on use.
    CREATE TABLE IF NOT EXISTS api_key_usage (
      key_id TEXT NOT NULL,
      bucket TEXT NOT NULL,
      hour TEXT NOT NULL,
      calls INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (key_id, bucket, hour)
    );
  `);
}

function hash(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function normaliseScopes(list) {
  if (!Array.isArray(list) || !list.length) return DEFAULT_SCOPES.slice();
  const out = list.map(s => String(s).trim()).filter(s => SCOPES[s]);
  return out.length ? [...new Set(out)] : DEFAULT_SCOPES.slice();
}

function shape(row) {
  return {
    id: row.id,
    name: row.name,
    key_prefix: row.key_prefix,
    scopes: JSON.parse(row.scopes),
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked: !!row.revoked_at,
  };
}

function list(userId) {
  return db.prepare('SELECT * FROM api_keys WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId).map(shape);
}

/**
 * Issue a key. The returned `key` is the only time the plaintext exists outside
 * the caller's hands — it is not stored and cannot be shown again.
 */
function create(userId, { name, scopes } = {}) {
  const secret = crypto.randomBytes(24).toString('base64url');
  const key = PREFIX + secret;
  const id = crypto.randomUUID();
  const scoped = normaliseScopes(scopes);
  db.prepare(`INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, scopes)
              VALUES (?,?,?,?,?,?)`)
    .run(id, userId, (name || 'Untitled key').slice(0, 80), hash(key),
         key.slice(0, PREFIX.length + 8), JSON.stringify(scoped));
  return { ...shape(db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id)), key };
}

function revoke(userId, id) {
  const r = db.prepare(`UPDATE api_keys SET revoked_at = datetime('now')
                        WHERE id = ? AND user_id = ? AND revoked_at IS NULL`).run(id, userId);
  return r.changes > 0;
}

/** Revoke and reissue in one step, so a leaked key can be replaced atomically. */
function rotate(userId, id) {
  const row = db.prepare('SELECT * FROM api_keys WHERE id = ? AND user_id = ?').get(id, userId);
  if (!row) return null;
  db.exec('BEGIN');
  try {
    db.prepare("UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?").run(id);
    const fresh = create(userId, { name: row.name, scopes: JSON.parse(row.scopes) });
    db.exec('COMMIT');
    return fresh;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/**
 * Resolve a presented key.
 *
 * Returns null for absent, malformed, unknown or revoked keys — deliberately
 * the same answer for all of them, so this cannot be used to probe which keys
 * exist.
 */
function verify(presented) {
  const raw = String(presented || '').trim();
  if (!raw.startsWith(PREFIX)) return null;
  const row = db.prepare('SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL')
    .get(hash(raw));
  if (!row) return null;
  try {
    db.prepare("UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?").run(row.id);
  } catch { /* never fail a request over telemetry */ }
  return { id: row.id, userId: row.user_id, scopes: JSON.parse(row.scopes), name: row.name };
}

function hasScope(key, scope) {
  return !!(key && Array.isArray(key.scopes) && key.scopes.includes(scope));
}

/**
 * Count a call against a key's hourly budget.
 * @returns {{ok:boolean, limit:number, remaining:number, reset:string}}
 */
function consume(keyId, bucket) {
  const limit = bucket === 'moment' ? MOMENT_LIMIT_PER_HOUR : RATE_LIMIT_PER_HOUR;
  const hour = new Date().toISOString().slice(0, 13);      // YYYY-MM-DDTHH
  db.prepare(`INSERT INTO api_key_usage (key_id, bucket, hour, calls) VALUES (?,?,?,1)
              ON CONFLICT(key_id, bucket, hour) DO UPDATE SET calls = calls + 1`)
    .run(keyId, bucket, hour);
  const row = db.prepare('SELECT calls FROM api_key_usage WHERE key_id = ? AND bucket = ? AND hour = ?')
    .get(keyId, bucket, hour);
  // Yesterday's rows are of no use to anyone.
  try { db.prepare('DELETE FROM api_key_usage WHERE hour < ?').run(
    new Date(Date.now() - 36e5 * 26).toISOString().slice(0, 13)); } catch {}
  const calls = row ? row.calls : 1;
  const reset = new Date(Date.now() + 36e5).toISOString().slice(0, 13) + ':00:00Z';
  return { ok: calls <= limit, limit, remaining: Math.max(0, limit - calls), reset };
}

module.exports = {
  init, list, create, revoke, rotate, verify, hasScope, consume,
  SCOPES, DEFAULT_SCOPES, RATE_LIMIT_PER_HOUR, MOMENT_LIMIT_PER_HOUR, PREFIX,
};
