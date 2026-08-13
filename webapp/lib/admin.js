/**
 * Admin: one durable account, one metrics read.
 *
 * "Durable" here means literally re-asserted on every boot, not a one-time
 * migration that could be undone by a future reseed or a database restore
 * from before the flag existed. ensureAdmin() runs on every server start;
 * it is idempotent (an UPDATE that no-ops when already correct), so this is
 * safe to call unconditionally forever, exactly as asked.
 */
'use strict';

const db = require('./db');
const visits = require('./visits');

const OWNER_EMAIL = 'alexmarcusgoldsmith@gmail.com';

function init() {
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes('is_admin')) db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
}

/**
 * Grants admin to OWNER_EMAIL if that account exists yet. Silent no-op if it
 * doesn't (someone hasn't signed up with that address on this database yet,
 * e.g. a fresh local/demo DB) -- called again on every boot, so the moment
 * the account exists it becomes admin without needing a manual step.
 */
function ensureAdmin() {
  const r = db.prepare('UPDATE users SET is_admin = 1 WHERE lower(email) = ? AND is_admin != 1')
    .run(OWNER_EMAIL.toLowerCase());
  if (r.changes) console.log(`[admin] granted admin to ${OWNER_EMAIL}`);
}

function isAdmin(userId) {
  const row = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(userId);
  return !!(row && row.is_admin);
}

function one(sql, ...args) { try { return db.prepare(sql).get(...args); } catch { return null; } }

/**
 * Everything on the admin metrics card. Every number here is a real COUNT
 * against real tables -- nothing estimated, nothing cached-and-stale.
 * "Visited" is read from user_sessions.last_seen_at, which account-security.js
 * already updates on real authenticated activity, not a page-view pixel.
 */
function metrics() {
  const totalUsers = one('SELECT COUNT(*) c FROM users').c;
  const signups24h = one("SELECT COUNT(*) c FROM users WHERE created_at > datetime('now','-1 day')").c;
  const signups7d = one("SELECT COUNT(*) c FROM users WHERE created_at > datetime('now','-7 days')").c;
  const active24h = one("SELECT COUNT(DISTINCT user_id) c FROM user_sessions WHERE last_seen_at > datetime('now','-1 day')").c;
  const active7d = one("SELECT COUNT(DISTINCT user_id) c FROM user_sessions WHERE last_seen_at > datetime('now','-7 days')").c;
  // Unauthenticated foot traffic -- distinct from active_24h/active_7d above,
  // which only see people who actually signed in. See lib/visits.js.
  const visitStats = visits.metrics();

  // "All systems go" -- the same optional integrations every part of this app
  // already degrades around, read back as a simple status list rather than a
  // separate health-check system to maintain.
  const systems = [
    { name: 'Database', ok: true }, // this query running at all proves it
    { name: 'Gloo AI', ok: !!(process.env.GLOO_API_KEY || (process.env.GLOO_CLIENT_ID && process.env.GLOO_CLIENT_SECRET)) },
    { name: 'YouVersion', ok: !!process.env.YOUVERSION_API_KEY },
    { name: 'Web push', ok: !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) },
    { name: 'YouTube ingestion', ok: !!process.env.YOUTUBE_API_KEY },
    { name: 'Email (password reset, accountability notices)', ok: !!(process.env.RESEND_API_KEY && process.env.EMAIL_FROM) },
  ];

  return {
    total_users: totalUsers,
    signups_24h: signups24h,
    signups_7d: signups7d,
    active_24h: active24h,
    active_7d: active7d,
    unique_visitors_today: visitStats.unique_today,
    unique_visitors_7d: visitStats.unique_7d,
    unique_visitors_30d: visitStats.unique_30d,
    unique_visitors_all_time: visitStats.unique_all_time,
    systems,
    all_systems_go: systems.every(s => s.ok),
    generated_at: new Date().toISOString(),
  };
}

module.exports = { init, ensureAdmin, isAdmin, metrics, OWNER_EMAIL };
