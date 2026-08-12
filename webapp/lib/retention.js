/**
 * Retention, the version that is good for the member.
 *
 * The app already had most of the honest pieces and none of the connective
 * tissue: `lib/daily.js` classifies the week (consistent / returning / resting /
 * starting) but only to choose a morning verse; `lib/effort.js` will only praise
 * something it can point at in the data; `/api/stats/summary` computes a streak
 * inline in one route handler and nobody else can read it; `lib/reminders.js`
 * fires only what the member asked for. What was missing was a single answer to
 * "how is this person doing, what have they not set up yet, and is there one
 * encouraging thing worth saying" — plus a ceiling on how often we may say it.
 *
 * Three things live here:
 *
 *   memberState()   one consolidated read: streak, consistency, last active,
 *                   standing, onboarding, who would notice, what would help.
 *   onboarding()    what a new member still has not set up, so the first week
 *                   can be guided instead of guessed at.
 *   decideNudge()   at most ONE encouraging message, or null and a reason.
 *
 * What is deliberately absent, and must stay absent:
 *
 *   - No "your streak ends in 4 hours". Loss aversion is the engine behind the
 *     apps this product exists as an alternative to, and the audience here
 *     starts at 13. `streakAtRisk()` is not missing by accident.
 *   - No streak freezes, repairs, or anything that makes a broken streak feel
 *     like a debt. A streak here is a description of the past, not a hostage.
 *   - No variable-ratio rewards. Everything returned is a deterministic function
 *     of what the member actually did; there is no `Math.random()` in this file.
 *   - No social comparison. `support()` returns the groups and partners who
 *     would notice you showed up. It does not return follower counts, ranks, or
 *     anyone else's numbers.
 *   - No time-on-app objective. Nothing here is measured in sessions or minutes
 *     in the app, and nothing tries to increase them.
 *
 * The frequency ceiling is LIMITS below, enforced by `allowance()` on every
 * single send. It is not a guideline in a comment — a caller that ignores
 * `decideNudge` and calls `sendNudge` directly is still refused.
 *
 * Degrades like every other module here: no VAPID keys means the encouragement
 * lands in the in-app bell and nothing leaves the server; a missing table or
 * column yields nulls, never a crash.
 */
'use strict';

const { randomUUID } = require('crypto');
const db = require('./db');
const push = require('./push');
const daily = require('./daily');
const accountSecurity = require('./account-security');

/**
 * The ceiling. Every value here is enforced in `allowance()`.
 *
 * These numbers are deliberately small. Three messages in three months is the
 * budget of something that respects being ignored, not something that competes
 * for attention. Minors get a stricter budget again, because a 13-year-old did
 * not consent to being retained.
 */
const LIMITS = {
  lapse_days: 10,          // below this a gap is a holiday, not a lapse
  dormant_days: 60,        // past this we stop entirely — silence is an answer
  min_days_between: 14,    // never two nudges inside a fortnight
  max_per_90_days: 3,
  max_per_90_days_minor: 2,
  max_lifetime: 8,         // an account can never receive more than this, ever
  quiet_from_hour: 9,      // local hour, inclusive
  quiet_to_hour: 20,       // local hour, exclusive
  onboarding_window_days: 21, // after three weeks we stop asking about setup
  max_per_sweep: 40,       // a bug in the sweep cannot page the whole database
};

/**
 * Copy this module refuses to send, whoever wrote it.
 *
 * The ToS forbids guilt and manufactured urgency; this makes that mechanical, so
 * a future contributor cannot land "don't lose your 14-day streak!" by editing a
 * string. Checked on the way out of `sendNudge`, not only at the author's desk.
 */
const DISALLOWED_COPY = new RegExp([
  "don'?t lose", 'lose your', 'losing your', 'about to lose', 'before it'+"'"+'?s gone',
  'streak (?:is )?(?:at risk|in danger|ends|expires?|broken)',
  'last chance', 'only \\d+ (?:hours?|days?) left', 'act now', 'hurry',
  'missing out', 'everyone else', 'falling behind', 'left behind',
  'you failed', 'we miss you', 'disappointed', 'let (?:us|yourself) down',
].join('|'), 'i');

// --- storage -------------------------------------------------------------

function init() {
  db.exec(`
    -- The ledger the ceiling is enforced against. Written for every nudge
    -- regardless of transport, so the cap holds even with push unconfigured
    -- (push_log only exists when VAPID keys do).
    CREATE TABLE IF NOT EXISTS retention_nudges (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      url TEXT,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_retention_nudges_user ON retention_nudges(user_id, sent_at DESC);
  `);

  // Additive, same pattern as lib/account-security.js. One switch, honoured
  // before anything else is even computed, and never defaulted to on.
  const cols = db.prepare('PRAGMA table_info(users)').all().map(c => c.name);
  const add = (name, ddl) => { if (!cols.includes(name)) db.exec(`ALTER TABLE users ADD COLUMN ${ddl}`); };
  add('retention_opt_out', 'retention_opt_out INTEGER NOT NULL DEFAULT 0');
  add('retention_opt_out_at', 'retention_opt_out_at TEXT');
}

// Every read is optional: a table or column that has not been created yet
// produces null/[] rather than taking a request down with it.
function one(sql, ...args) { try { return db.prepare(sql).get(...args); } catch { return null; } }
function all(sql, ...args) { try { return db.prepare(sql).all(...args); } catch { return []; } }
function count(sql, ...args) { const r = one(sql, ...args); return r ? Number(r.c) || 0 : 0; }

const DAY_MS = 24 * 60 * 60 * 1000;
function isoDay(date) { return new Date(date).toISOString().slice(0, 10); }
function parseTs(value) {
  if (!value) return null;
  // SQLite datetime('now') writes "YYYY-MM-DD HH:MM:SS" with no zone; it is UTC.
  const t = Date.parse(/^\d{4}-\d{2}-\d{2} /.test(String(value)) ? String(value).replace(' ', 'T') + 'Z' : value);
  return Number.isFinite(t) ? t : null;
}
function daysSince(value, now) {
  const t = parseTs(value);
  return t == null ? null : Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

// --- the facts -----------------------------------------------------------

/**
 * The most recent evidence the member was actually here.
 *
 * Session heartbeat first (lib/account-security.js keeps it), then the things
 * that only happen deliberately. Falls back to signup so a brand-new account is
 * never mistaken for a dormant one.
 */
function lastActiveAt(userId) {
  const candidates = [
    one('SELECT MAX(last_seen_at) v FROM user_sessions WHERE user_id = ?', userId),
    one('SELECT MAX(COALESCE(end_time, start_time)) v FROM workouts WHERE user_id = ?', userId),
    one('SELECT MAX(created_at) v FROM posts WHERE user_id = ?', userId),
    one('SELECT created_at v FROM users WHERE id = ?', userId),
  ].map(r => (r && r.v) || null).filter(Boolean);
  if (!candidates.length) return null;
  return candidates.reduce((best, v) => ((parseTs(v) || 0) > (parseTs(best) || 0) ? v : best));
}

/** Distinct UTC days with a completed workout, newest first. */
function activityDays(userId, windowDays = 400) {
  return all(`SELECT DISTINCT date(end_time) AS day FROM workouts
              WHERE user_id = ? AND end_time IS NOT NULL AND end_time > datetime('now', ?)
              ORDER BY day DESC`, userId, '-' + Math.max(1, windowDays) + ' days')
    .map(r => r.day).filter(Boolean);
}

/**
 * Consistency, described rather than gamified.
 *
 * `current_days` matches /api/stats/summary exactly (consecutive days ending
 * today or yesterday) so the two surfaces never disagree in front of a member.
 *
 * `active_days_last_28` is the number this module actually prefers: it survives
 * a rest day, it survives illness, and it cannot be lost in one evening. A
 * streak is a fragile measure of a robust thing, and a member who misses a
 * Tuesday has not undone eleven weeks of work.
 */
function consistency(userId, now = new Date()) {
  const days = activityDays(userId);
  const set = new Set(days);

  let cursor = new Date(now);
  if (!set.has(isoDay(cursor))) cursor = new Date(cursor.getTime() - DAY_MS); // yesterday still counts
  let current = 0;
  while (set.has(isoDay(cursor))) { current++; cursor = new Date(cursor.getTime() - DAY_MS); }

  let longest = 0, run = 0, prev = null;
  for (const day of [...set].sort()) {
    run = (prev && Date.parse(day + 'T00:00:00Z') - Date.parse(prev + 'T00:00:00Z') === DAY_MS) ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = day;
  }

  const since = n => days.filter(d => now.getTime() - Date.parse(d + 'T00:00:00Z') <= n * DAY_MS).length;
  const last = one(`SELECT MAX(end_time) v FROM workouts WHERE user_id = ? AND end_time IS NOT NULL`, userId);
  return {
    current_days: current,
    longest_days: longest,
    active_days_last_28: since(28),
    active_days_last_90: since(90),
    total_workouts: count('SELECT COUNT(*) c FROM workouts WHERE user_id = ? AND end_time IS NOT NULL', userId),
    last_workout_at: (last && last.v) || null,
  };
}

/**
 * Who would actually notice this member showing up.
 *
 * Real, reciprocal relationships only: groups they belong to and workout
 * partners who accepted. There is no follower count here and there will not be
 * one — a number that goes up when strangers watch you is the exact thing the
 * ToS calls vanity, and it is not accountability.
 */
function support(userId) {
  const groups = all(`SELECT g.id, g.name,
      (SELECT COUNT(*) FROM group_members m2 WHERE m2.group_id = g.id) AS members
    FROM group_members m JOIN groups g ON g.id = m.group_id
    WHERE m.user_id = ? ORDER BY members DESC LIMIT 5`, userId);
  const partners = count(`SELECT COUNT(DISTINCT partner_user_id) c FROM workout_partners
                          WHERE tagged_by = ? AND status = 'accepted'`, userId)
    + count(`SELECT COUNT(DISTINCT tagged_by) c FROM workout_partners
             WHERE partner_user_id = ? AND status = 'accepted'`, userId);
  const inGroups = count(`SELECT COUNT(DISTINCT m2.user_id) c FROM group_members m
      JOIN group_members m2 ON m2.group_id = m.group_id AND m2.user_id <> m.user_id
      WHERE m.user_id = ?`, userId);
  return {
    groups,
    partners,
    would_notice: inGroups + partners,
    alone: groups.length === 0 && partners === 0,
  };
}

// --- onboarding ----------------------------------------------------------

/**
 * What a new member has not set up yet.
 *
 * Every step here unlocks something real — scripture in their own translation,
 * a group that notices them, a challenge short enough to finish. None of them
 * exist to raise a completion percentage, and `core` marks the four that
 * genuinely change the experience; the rest are offered, never chased.
 *
 * This is a read. It is surfaced during `onboarding_window_days` and then the
 * app stops asking: an eleven-month-old account being told its profile is 71%
 * complete is nagging, not onboarding.
 */
function onboarding(userId, now = new Date()) {
  const u = one(`SELECT id, display_name, job, church, church_name, bio_verse_ref, avatar_data,
                        tradition, bible_version_id, created_at FROM users WHERE id = ?`, userId) || {};
  const has = (sql, ...a) => count(sql, ...a) > 0;
  const pushAvailable = push.isConfigured();

  const steps = [
    { key: 'profile', title: 'Say who you are',
      why: 'A line about your church, your gym or a verse that matters lets people here recognise you.',
      core: true, available: true, url: '/?open=profile',
      done: !!(u.display_name && (u.job || u.church || u.church_name || u.bio_verse_ref)) },
    { key: 'tradition', title: 'Choose your translation',
      why: 'Scripture then arrives in the words you already know, instead of ours.',
      core: true, available: true, url: '/?open=profile',
      done: !!(u.tradition || u.bible_version_id) },
    { key: 'first_workout', title: 'Log one session',
      why: 'A walk counts. Everything else in the app is built on top of this one thing.',
      core: true, available: true, url: '/?open=home',
      done: has('SELECT COUNT(*) c FROM workouts WHERE user_id = ?', userId) },
    { key: 'community', title: 'Join a group',
      why: 'Showing up matters more when somebody notices. This is the step that makes it stick.',
      core: true, available: true, url: '/?open=home',
      done: has('SELECT COUNT(*) c FROM group_members WHERE user_id = ?', userId)
         || has(`SELECT COUNT(*) c FROM workout_partners
                 WHERE status = 'accepted' AND (tagged_by = ? OR partner_user_id = ?)`, userId, userId) },
    { key: 'challenge', title: 'Pick a short challenge',
      why: 'First Steps is three sessions. A finishable goal beats an impressive one.',
      core: false, available: true, url: '/?open=challenges',
      done: has('SELECT COUNT(*) c FROM user_challenges WHERE user_id = ?', userId) },
    { key: 'avatar', title: 'Add a profile photo',
      why: 'Optional. It helps people in your group put a face to your name.',
      core: false, available: true, url: '/?open=profile',
      done: !!u.avatar_data },
    { key: 'notifications', title: 'Decide what may reach you',
      why: 'Every category is separate and every one is off until you say otherwise.',
      core: false, available: pushAvailable, url: '/?open=profile',
      done: has('SELECT COUNT(*) c FROM push_subscriptions WHERE user_id = ?', userId) },
  ];

  const offered = steps.filter(s => s.available);
  const core = offered.filter(s => s.core);
  const ageDays = daysSince(u.created_at, now);
  return {
    steps: offered,
    completed: offered.filter(s => s.done).length,
    total: offered.length,
    percent: offered.length ? Math.round((offered.filter(s => s.done).length / offered.length) * 100) : 100,
    core_complete: core.every(s => s.done),
    // The single next thing, not a to-do list to feel behind on.
    next: core.find(s => !s.done) || offered.find(s => !s.done) || null,
    // False once the window closes: the UI should stop showing setup guidance.
    in_window: ageDays == null || ageDays <= LIMITS.onboarding_window_days,
    account_age_days: ageDays,
  };
}

// --- standing and suggestion ---------------------------------------------

/**
 * One word for where this member is, derived only from what they did.
 *
 * `quiet` versus `lapsed` is the distinction that matters and the reason this
 * defers to `daily.weekShape`: a blank week after months of consistency is rest,
 * and telling that person to get back on track would be both wrong and unkind.
 */
function standing(row) {
  if (row.suspended) return 'suspended';
  const away = row.days_since_active;
  if (row.consistency.total_workouts === 0 && (row.days_since_joining ?? 0) <= LIMITS.onboarding_window_days) return 'new';
  if (away != null && away >= LIMITS.dormant_days) return 'dormant';
  if (away != null && away >= LIMITS.lapse_days) return 'lapsed';
  if (row.week.pool === 'resting') return 'quiet';
  if (row.consistency.active_days_last_28 >= 8) return 'steady';
  return 'settling';
}

/**
 * What would genuinely help next — for the screen, not for a notification.
 *
 * Every branch is allowed to say "nothing", and the `quiet` branch actively
 * affirms rest rather than treating a calm week as a problem to be solved.
 */
function suggestion(state) {
  const c = state.consistency;
  switch (state.standing) {
    case 'new':
      return state.onboarding.next
        ? { kind: 'onboarding', headline: state.onboarding.next.title, detail: state.onboarding.next.why, url: state.onboarding.next.url }
        : null;
    case 'lapsed':
      return { kind: 'restart',
        headline: 'Pick this back up whenever you want',
        detail: c.total_workouts >= 5
          ? `You logged ${c.total_workouts} sessions before the break. You start from there, not from zero.`
          : 'One short walk is a completely valid restart.',
        url: '/?open=challenges' };
    case 'dormant':
      return null; // we have said our piece; the app waits
    case 'quiet':
      return { kind: 'rest',
        headline: 'A quiet week is still a week',
        detail: `${c.active_days_last_90} active days in the last three months. Rest is part of that, not a gap in it.`,
        url: '/?open=stats' };
    case 'steady':
      if (state.support.alone) {
        return { kind: 'community',
          headline: 'You are doing this on your own',
          detail: 'Joining one group means somebody notices when you show up. No posting required.',
          url: '/?open=home' };
      }
      return { kind: 'keep_going',
        headline: 'You have moved ' + c.active_days_last_28 + ' of the last 28 days',
        detail: 'That is the number worth watching. It survives a rest day.',
        url: '/?open=stats' };
    default:
      if (state.onboarding.in_window && state.onboarding.next) {
        return { kind: 'onboarding', headline: state.onboarding.next.title, detail: state.onboarding.next.why, url: state.onboarding.next.url };
      }
      return c.total_workouts > 0
        ? { kind: 'keep_going',
            headline: 'Whatever this week looks like, log it',
            detail: `${c.active_days_last_28} active days in the last 28. Honest beats impressive.`,
            url: '/?open=stats' }
        : null;
  }
}

/**
 * Everything about one member's rhythm, in a single call.
 *
 * Safe to hand straight to a route: contains no other member's data, no ranks,
 * and nothing about anyone the caller cannot already see.
 */
function memberState(userId, now = new Date()) {
  const u = one(`SELECT id, display_name, created_at FROM users WHERE id = ?`, userId);
  if (!u) return null;
  const flags = one(`SELECT suspended_at, retention_opt_out, date_of_birth FROM users WHERE id = ?`, userId) || {};
  const lastActive = lastActiveAt(userId);
  const shape = (() => { try { return daily.weekShape(userId); } catch { return { pool: 'starting', facts: [] }; } })();

  const state = {
    user_id: u.id,
    display_name: u.display_name || null,
    joined_at: u.created_at || null,
    days_since_joining: daysSince(u.created_at, now),
    last_active_at: lastActive,
    days_since_active: daysSince(lastActive, now),
    suspended: !!flags.suspended_at,
    consistency: consistency(userId, now),
    week: { pool: shape.pool, label: (daily.POOLS[shape.pool] || {}).label || null, facts: shape.facts || [] },
    onboarding: onboarding(userId, now),
    support: support(userId),
    nudges: {
      opted_out: !!flags.retention_opt_out,
      sent_lifetime: count('SELECT COUNT(*) c FROM retention_nudges WHERE user_id = ?', userId),
      last_sent_at: (one('SELECT MAX(sent_at) v FROM retention_nudges WHERE user_id = ?', userId) || {}).v || null,
      // Published so the member can see the ceiling that applies to them.
      ceiling: nudgeCeiling(flags.date_of_birth),
      window_days: 90,
    },
  };
  state.standing = standing(state);
  state.suggestion = suggestion(state);
  return state;
}

// --- the ceiling ---------------------------------------------------------

function nudgeCeiling(dateOfBirth) {
  let age = null;
  try { age = accountSecurity.ageFromDob(dateOfBirth); } catch { age = null; }
  // Unknown age is treated as a minor. The stricter budget is the safe default.
  return (age == null || age < 18) ? LIMITS.max_per_90_days_minor : LIMITS.max_per_90_days;
}

/**
 * May we send this member anything at all right now?
 *
 * Enforced on every send, including sends that skipped `decideNudge`. Returns a
 * reason rather than a bare false so a refusal is debuggable and so the app can
 * honestly answer "why did I not hear from you".
 */
function allowance(userId, now = new Date()) {
  const u = one(`SELECT id, suspended_at, retention_opt_out, date_of_birth FROM users WHERE id = ?`, userId);
  if (!u) return { ok: false, reason: 'unknown_user' };
  if (u.retention_opt_out) return { ok: false, reason: 'opted_out' };
  if (u.suspended_at) return { ok: false, reason: 'suspended' };

  const hour = now.getHours();
  if (hour < LIMITS.quiet_from_hour || hour >= LIMITS.quiet_to_hour) return { ok: false, reason: 'quiet_hours' };

  const lifetime = count('SELECT COUNT(*) c FROM retention_nudges WHERE user_id = ?', userId);
  if (lifetime >= LIMITS.max_lifetime) return { ok: false, reason: 'lifetime_cap' };

  const recent = count(`SELECT COUNT(*) c FROM retention_nudges WHERE user_id = ? AND sent_at > datetime('now', '-90 days')`, userId);
  const ceiling = nudgeCeiling(u.date_of_birth);
  if (recent >= ceiling) return { ok: false, reason: 'quarterly_cap', ceiling };

  const last = one('SELECT MAX(sent_at) v FROM retention_nudges WHERE user_id = ?', userId);
  const sinceLast = daysSince(last && last.v, now);
  if (sinceLast != null && sinceLast < LIMITS.min_days_between) return { ok: false, reason: 'too_soon', days_since_last: sinceLast };

  return { ok: true, remaining: ceiling - recent };
}

// --- deciding what, if anything, to say ----------------------------------

/**
 * At most one encouraging message, or null and the reason why not.
 *
 * Two kinds exist and no more. Both are pure functions of the member's own
 * history, both are sent once at most in a fortnight, and both stop entirely at
 * `dormant_days`. The copy names something true; it never counts the days they
 * were away back at them.
 */
function decideNudge(userId, now = new Date()) {
  const gate = allowance(userId, now);
  if (!gate.ok) return { send: false, reason: gate.reason, allowance: gate };

  const state = memberState(userId, now);
  if (!state) return { send: false, reason: 'unknown_user' };

  const away = state.days_since_active;
  const c = state.consistency;

  // A member who is here does not need to be told to come back.
  if (away == null || away < LIMITS.lapse_days) return { send: false, reason: 'still_active', state_standing: state.standing };
  if (away >= LIMITS.dormant_days) return { send: false, reason: 'dormant', state_standing: state.standing };
  // Deliberately NOT gated on `week.pool === 'resting'`. weekShape compares the
  // last 7 days against the 28 before them, so anyone 10-35 days away still reads
  // as "resting" — the guard would have silenced this branch for exactly the
  // people it exists for. Rest means present but not training, and someone
  // present is already excluded above. This is the same idea done on real data:
  // a recent session means they are training, whatever the session log says.
  const sinceWorkout = daysSince(c.last_workout_at, now);
  if (sinceWorkout != null && sinceWorkout < LIMITS.lapse_days) {
    return { send: false, reason: 'trained_recently', state_standing: state.standing };
  }

  if (c.total_workouts === 0) {
    // Never got started. One message, pointed at the single next setup step,
    // and only inside the first three weeks.
    if (!state.onboarding.in_window) return { send: false, reason: 'onboarding_window_closed' };
    const already = count("SELECT COUNT(*) c FROM retention_nudges WHERE user_id = ? AND kind = 'first_week'", userId);
    if (already > 0) return { send: false, reason: 'first_week_already_sent' };
    const step = state.onboarding.next;
    if (!step) return { send: false, reason: 'nothing_left_to_set_up' };
    return {
      send: true,
      reason: 'first_week',
      nudge: { kind: 'first_week', title: 'Whenever you are ready', body: step.why, url: step.url },
    };
  }

  // Came back before, then stopped. Point at the work they already did.
  const body = c.total_workouts >= 5
    ? `You logged ${c.total_workouts} sessions here. Whenever you pick it back up, you start from there.`
    : 'One short walk is a completely valid restart. No catching up required.';
  return {
    send: true,
    reason: 'return',
    nudge: { kind: 'return', title: 'Still here', body, url: '/?open=challenges' },
  };
}

// --- delivery ------------------------------------------------------------

/** Copy that breaks the product's own rules is dropped, not sent. */
function copyIsKind(nudge) {
  return !DISALLOWED_COPY.test(`${nudge.title || ''} ${nudge.body || ''}`);
}

/**
 * Deliver one nudge and record it.
 *
 * Re-checks `allowance` itself: the ceiling is a property of this module, not of
 * whoever called it. Push respects the member's existing `reminders` opt-in and
 * is fire-and-forget; with no VAPID keys the message still lands in the in-app
 * bell and nothing leaves the server.
 */
async function sendNudge(userId, nudge) {
  const gate = allowance(userId);
  if (!gate.ok) return { sent: false, reason: gate.reason };
  if (!nudge || !nudge.kind || !nudge.title || !nudge.body) return { sent: false, reason: 'malformed_nudge' };
  if (!copyIsKind(nudge)) {
    console.error('[retention] refused to send %s: copy breaks the no-guilt rule', nudge.kind);
    return { sent: false, reason: 'disallowed_copy' };
  }

  const url = typeof nudge.url === 'string' && nudge.url.startsWith('/') && !nudge.url.startsWith('//')
    ? nudge.url : '/?open=home';
  const id = randomUUID();
  // Written before delivery: a push that fails must still consume the budget,
  // otherwise a flaky endpoint becomes a way to send the same person more.
  db.prepare('INSERT INTO retention_nudges (id, user_id, kind, title, body, url) VALUES (?,?,?,?,?,?)')
    .run(id, userId, nudge.kind, nudge.title, nudge.body, url);
  db.prepare('INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), userId, 'encouragement',
         JSON.stringify({ message: nudge.body, title: nudge.title, body: nudge.body, url, nudge_id: id, kind: nudge.kind }));

  let delivered = { sent: 0 };
  try {
    delivered = await push.send(userId, 'reminders', { title: nudge.title, body: nudge.body, url, tag: 'retention:' + nudge.kind });
  } catch (err) {
    console.error('[retention] push failed for %s: %s', nudge.kind, err.message);
  }
  return { sent: true, id, kind: nudge.kind, pushed: delivered.sent || 0 };
}

/** What this member has been sent, so they can see it and so it can be audited. */
function history(userId, limit = 20) {
  return all(`SELECT id, kind, title, body, url, sent_at FROM retention_nudges
              WHERE user_id = ? ORDER BY sent_at DESC LIMIT ?`, userId, Math.min(50, Math.max(1, Number(limit) || 20)));
}

/** One switch, honoured before anything else is computed. Reversible. */
function setOptOut(userId, optedOut) {
  const value = optedOut ? 1 : 0;
  db.prepare(`UPDATE users SET retention_opt_out = ?, retention_opt_out_at = CASE WHEN ? = 1 THEN datetime('now') ELSE NULL END WHERE id = ?`)
    .run(value, value, userId);
  return { opted_out: !!value };
}

// --- the sweep -----------------------------------------------------------

/**
 * Consider everyone once and send to almost nobody.
 *
 * The candidate query already excludes opted-out accounts and anyone nudged
 * inside `min_days_between`, so the common case is a scan that sends nothing.
 * `max_per_sweep` bounds the damage if a future change to `decideNudge` starts
 * saying yes far more often than it should.
 */
async function runOnce() {
  const candidates = all(`
    SELECT u.id FROM users u
    WHERE COALESCE(u.retention_opt_out, 0) = 0
      AND u.suspended_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM retention_nudges n WHERE n.user_id = u.id
                       AND n.sent_at > datetime('now', '-${LIMITS.min_days_between} days'))
    ORDER BY u.created_at DESC LIMIT 2000`).map(r => r.id);

  let sent = 0;
  for (const userId of candidates) {
    if (sent >= LIMITS.max_per_sweep) break;
    try {
      const decision = decideNudge(userId);
      if (!decision.send) continue;
      const result = await sendNudge(userId, decision.nudge);
      if (result.sent) sent++;
    } catch (err) {
      console.error('[retention] %s: %s', userId, err.message); // one member's failure is not everyone's
    }
    await new Promise(r => setTimeout(r, 100));
  }
  if (sent) console.log('[retention] sent %d encouragement(s) across %d candidates', sent, candidates.length);
  return { considered: candidates.length, sent };
}

let timer = null;
function start() {
  init();
  // Six-hourly, and `allowance` throws away every tick outside daylight hours.
  // Slow on purpose: the cheapest way to guarantee this is never noisy is for
  // the loop that could be noisy to hardly ever run.
  timer = setInterval(() => { runOnce().catch(err => console.error('[retention] sweep error:', err.message)); }, 6 * 60 * 60 * 1000);
  if (timer.unref) timer.unref();
  console.log('[retention] encouragement sweep ready — max %d per member per 90 days, %d days apart',
    LIMITS.max_per_90_days, LIMITS.min_days_between);
}

module.exports = {
  init, start, runOnce,
  memberState, consistency, onboarding, support, lastActiveAt,
  allowance, decideNudge, sendNudge, history, setOptOut,
  LIMITS, DISALLOWED_COPY,
};
