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

const OWNER_EMAIL = 'alexgoldsmith@goldstarorbital.com';
const FEATURE_DEFAULTS = Object.freeze({
  reels: true,
  journeys: true,
  news: true,
  member_reels: true,
});

function init() {
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  if (!cols.includes('is_admin')) db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_features (
      key TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT
    );
    CREATE TABLE IF NOT EXISTS support_tickets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      subject TEXT NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      admin_note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status, created_at);
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id TEXT PRIMARY KEY,
      admin_user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON admin_audit_log(created_at);
  `);
  const insert = db.prepare('INSERT OR IGNORE INTO platform_features(key,enabled) VALUES(?,?)');
  Object.entries(FEATURE_DEFAULTS).forEach(([key, enabled]) => insert.run(key, enabled ? 1 : 0));
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

function features() {
  const rows = all('SELECT key, enabled, updated_at, updated_by FROM platform_features');
  const values = { ...FEATURE_DEFAULTS };
  const meta = {};
  rows.forEach(row => { if (Object.hasOwn(FEATURE_DEFAULTS, row.key)) { values[row.key] = !!row.enabled; meta[row.key] = row; } });
  return { features: values, meta };
}

function featureEnabled(key) { return features().features[key] !== false; }

function audit(adminUserId, action, targetType, targetId, detail = null) {
  const { randomUUID } = require('crypto');
  db.prepare('INSERT INTO admin_audit_log(id,admin_user_id,action,target_type,target_id,detail) VALUES(?,?,?,?,?,?)')
    .run(randomUUID(), adminUserId, String(action).slice(0,80), targetType && String(targetType).slice(0,80), targetId && String(targetId).slice(0,120), detail && String(detail).slice(0,1200));
}

function setFeature(adminUserId, key, enabled) {
  if (!Object.hasOwn(FEATURE_DEFAULTS, key)) throw Object.assign(new Error('Unknown feature.'), { code: 'unknown_feature' });
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO platform_features(key,enabled,updated_at,updated_by) VALUES(?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at,updated_by=excluded.updated_by`)
    .run(key, enabled ? 1 : 0, now, adminUserId);
  audit(adminUserId, enabled ? 'feature_enabled' : 'feature_disabled', 'feature', key);
  return features();
}

function createTicket(userId, input) {
  const { randomUUID } = require('crypto');
  const category = ['bug', 'account', 'safety', 'other'].includes(input.category) ? input.category : 'other';
  const subject = String(input.subject || '').trim().slice(0, 140);
  const detail = String(input.detail || '').trim().slice(0, 1800);
  if (subject.length < 3 || detail.length < 10) throw Object.assign(new Error('Add a subject and enough detail for the team to help.'), { code: 'ticket_details_required' });
  const recent = one("SELECT COUNT(*) c FROM support_tickets WHERE user_id=? AND created_at>=datetime('now','-1 day')", userId)?.c || 0;
  if (recent >= 5) throw Object.assign(new Error('Please wait before opening another support request.'), { code: 'ticket_rate_limited' });
  const id = randomUUID();
  db.prepare('INSERT INTO support_tickets(id,user_id,category,subject,detail) VALUES(?,?,?,?,?)').run(id, userId, category, subject, detail);
  return db.prepare('SELECT id,category,subject,status,created_at FROM support_tickets WHERE id=?').get(id);
}

function listTickets(status = 'open') {
  const allowed = ['open', 'resolved', 'all'];
  const state = allowed.includes(status) ? status : 'open';
  const where = state === 'all' ? '' : 'WHERE t.status = ?';
  return all(`SELECT t.*,u.display_name,u.email FROM support_tickets t JOIN users u ON u.id=t.user_id ${where} ORDER BY t.created_at DESC LIMIT 100`, ...(state === 'all' ? [] : [state]));
}

function resolveTicket(adminUserId, id, note) {
  const cleaned = String(note || '').trim().slice(0, 1000);
  const ticket = one('SELECT * FROM support_tickets WHERE id=?', id);
  if (!ticket) throw Object.assign(new Error('Ticket not found.'), { code: 'not_found' });
  const now = new Date().toISOString();
  db.prepare("UPDATE support_tickets SET status='resolved',admin_note=?,updated_at=?,resolved_at=? WHERE id=?").run(cleaned || null, now, now, id);
  audit(adminUserId, 'support_ticket_resolved', 'support_ticket', id, cleaned || null);
  return one('SELECT * FROM support_tickets WHERE id=?', id);
}

function sendSupportNote(adminUserId, userId, message) {
  const { randomUUID } = require('crypto');
  const note = String(message || '').trim().slice(0, 500);
  if (note.length < 3) throw Object.assign(new Error('Write a helpful note first.'), { code: 'support_note_required' });
  if (!one('SELECT id FROM users WHERE id=?', userId)) throw Object.assign(new Error('Member not found.'), { code: 'not_found' });
  db.prepare('INSERT INTO notifications(id,user_id,type,payload) VALUES(?,?,?,?)').run(randomUUID(), userId, 'admin_support', JSON.stringify({ message: note, url: '/?open=profile' }));
  audit(adminUserId, 'support_note_sent', 'user', userId, note);
  return { ok: true };
}

function publishVideo(adminUserId, input) {
  let url;
  try { url = new URL(String(input.source_url || '')); } catch { throw Object.assign(new Error('Use a valid YouTube or Vimeo URL.'), { code: 'invalid_video_url' }); }
  let provider = null, videoId = null;
  if (url.hostname === 'youtu.be') { provider = 'youtube'; videoId = url.pathname.slice(1); }
  else if (/(^|\.)youtube\.com$/i.test(url.hostname)) { provider = 'youtube'; videoId = url.searchParams.get('v') || (/^\/shorts\/([^/]+)/.exec(url.pathname) || [])[1]; }
  else if (/(^|\.)vimeo\.com$/i.test(url.hostname)) { provider = 'vimeo'; videoId = (/^\/(\d+)/.exec(url.pathname) || [])[1]; }
  if ((provider === 'youtube' && !/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) || (provider === 'vimeo' && !/^\d{6,12}$/.test(videoId || ''))) {
    throw Object.assign(new Error('Use a valid YouTube or Vimeo video URL.'), { code: 'invalid_video_url' });
  }
  const title = String(input.title || '').trim().slice(0, 160);
  const category = String(input.category || '').trim();
  const purpose = String(input.community_purpose || '').trim().slice(0, 1000);
  const categories = new Set(['motivation', 'fitness', 'food', 'kids', 'christian']);
  if (!title || !categories.has(category) || purpose.length < 10 || !input.rights_confirmed) {
    throw Object.assign(new Error('Title, approved category, community purpose, and rights confirmation are required.'), { code: 'content_details_required' });
  }
  const { randomUUID } = require('crypto');
  const now = new Date().toISOString();
  const thumbnail = provider === 'youtube' ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null;
  db.prepare(`INSERT INTO videos(id,category,video_id,title,description,thumbnail_url,channel_title,published_at,is_short,language_flag,source_kind,source_note,provider,source_url,last_checked_at)
    VALUES(?,?,?,?,?,?,?,?,1,0,'functioning_faith',?,?,?,?)
    ON CONFLICT(category,video_id) DO UPDATE SET title=excluded.title,description=excluded.description,thumbnail_url=excluded.thumbnail_url,channel_title=excluded.channel_title,source_kind='functioning_faith',source_note=excluded.source_note,provider=excluded.provider,source_url=excluded.source_url,dead_at=NULL,last_checked_at=excluded.last_checked_at`)
    .run(randomUUID(), category, videoId, title, purpose, thumbnail, 'Functioning Faith', now, 'admin:direct', provider, url.toString(), now);
  audit(adminUserId, 'video_published', 'video', `${provider}:${videoId}`, title);
  return { provider, video_id: videoId, title, category };
}

function issueSummary() {
  return {
    support_open: count('support_tickets', "WHERE status='open'"),
    moderation_open: count('moderation_queue', "WHERE status='pending'"),
    developer_content_pending: count('developer_content_submissions', "WHERE moderation_status='pending'"),
  };
}

module.exports = { init, ensureAdmin, isAdmin, metrics, contentCounts, dailyTrend, listUsers, features, featureEnabled, setFeature, createTicket, listTickets, resolveTicket, sendSupportNote, publishVideo, issueSummary, audit, OWNER_EMAIL };
