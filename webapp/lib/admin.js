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
function all(sql, ...args) { try { return db.prepare(sql).all(...args); } catch { return []; } }
// Content/feature tables are spread across many lib/*.js files built up over
// this whole session -- wrapping every count in one() (which already
// swallows errors) means a table that doesn't exist yet on an older DB just
// reads as 0 instead of taking the whole dashboard down.
function count(table, where = '') {
  const row = one(`SELECT COUNT(*) c FROM ${table} ${where}`);
  return row ? row.c : 0;
}

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
  // Excludes admin accounts -- an owner testing their own app is not a
  // member being active, and would otherwise inflate this every time they
  // open it themselves.
  const active24h = one(`SELECT COUNT(DISTINCT s.user_id) c FROM user_sessions s
    JOIN users u ON u.id = s.user_id WHERE s.last_seen_at > datetime('now','-1 day') AND u.is_admin = 0`).c;
  const active7d = one(`SELECT COUNT(DISTINCT s.user_id) c FROM user_sessions s
    JOIN users u ON u.id = s.user_id WHERE s.last_seen_at > datetime('now','-7 days') AND u.is_admin = 0`).c;
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

/** Platform-wide content/feature counts -- everything built up this session,
 *  read back as real numbers instead of scattered across a dozen tabs. */
function contentCounts() {
  return {
    workouts: count('workouts'),
    posts: count('posts'),
    groups: count('groups'),
    dm_messages: count('dm_messages'),
    athlete_profiles: count('athlete_profiles'),
    athlete_profiles_public: count('athlete_profiles', "WHERE is_public = 1"),
    coach_profiles: count('coach_profiles'),
    coach_profiles_verified: count('coach_profiles', "WHERE edu_verified_at IS NOT NULL"),
    schools_synced: count('schools'),
    moderation_pending: count('moderation_queue', "WHERE status = 'pending'"),
    webhook_endpoints: count('webhooks'),
    api_keys: count('api_keys'),
  };
}

/** Daily signups and daily active-user counts for the last `days` days, for
 *  a simple trend line rather than just point-in-time snapshots. Always
 *  returns one row per day (zero-filled), oldest first, so the client can
 *  plot it directly without hole-filling. */
function dailyTrend(days = 30) {
  const n = Math.min(Math.max(Number(days) || 30, 7), 90);
  const signupRows = all(`
    SELECT date(created_at) d, COUNT(*) c FROM users
    WHERE created_at > datetime('now', ?)
    GROUP BY d
  `, `-${n} days`);
  const activeRows = all(`
    SELECT date(s.last_seen_at) d, COUNT(DISTINCT s.user_id) c FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.last_seen_at > datetime('now', ?) AND u.is_admin = 0
    GROUP BY d
  `, `-${n} days`);
  const signupsByDay = Object.fromEntries(signupRows.map(r => [r.d, r.c]));
  const activeByDay = Object.fromEntries(activeRows.map(r => [r.d, r.c]));
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    out.push({ date: d, signups: signupsByDay[d] || 0, active: activeByDay[d] || 0 });
  }
  return out;
}

/** Paginated, searchable user directory for the admin dashboard -- not just
 *  a count, an actual list. Search matches email or display name. */
function listUsers({ q, limit = 50, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  const params = {};
  let where = '';
  if (q) {
    where = 'WHERE u.email LIKE @q ESCAPE \'\\\' OR u.display_name LIKE @q ESCAPE \'\\\'';
    params.q = '%' + String(q).slice(0, 80).replace(/[\\%_]/g, c => '\\' + c) + '%';
  }
  const rows = all(`
    SELECT u.id, u.email, u.display_name, u.recruiting_role, u.is_admin, u.created_at,
      (SELECT MAX(last_seen_at) FROM user_sessions WHERE user_id = u.id) AS last_seen_at
    FROM users u
    ${where}
    ORDER BY u.created_at DESC
    LIMIT @limit OFFSET @offset
  `, { ...params, limit: lim, offset: off });
  const total = one(`SELECT COUNT(*) c FROM users u ${where}`, params)?.c || 0;
  return { users: rows, total, limit: lim, offset: off };
}

module.exports = { init, ensureAdmin, isAdmin, metrics, contentCounts, dailyTrend, listUsers, OWNER_EMAIL };
