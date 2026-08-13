/**
 * Functioning Faith ops agent.
 *
 * A separate, bounded maintenance run -- not a copy of the web server, and
 * not an AI agent. It does exactly the chores below, once, then exits. No
 * LLM calls, no code changes, nothing open-ended: every task here is
 * something the app already knows how to do, just not on a schedule that
 * survives the web dyno restarting.
 *
 * Why this exists as its own file: the same chores already run inside the
 * web process via setInterval (see lib/news.js, lib/podcasts.js,
 * lib/retention.js), which is fine as long as that process stays up. It
 * doesn't always -- deploys restart it, crashes restart it, a platform
 * outage takes it down for a while. This script talks to the same SQLite
 * database directly and can be scheduled as its own Railway service with a
 * cron trigger, so the chores still happen on days the web process didn't
 * see. Deploying it as a second service is an infrastructure change with
 * its own cost on Railway -- that's a deliberate step for a human to take
 * in the Railway dashboard, not something this script does to itself.
 *
 * Usage: `node ops-agent.js` (from webapp/). Exits 0 on success, logs and
 * exits 1 if any task threw. Safe to run as often as you like -- every task
 * here is idempotent.
 */
'use strict';

const db = require('./lib/db');
const news = require('./lib/news');
const podcasts = require('./lib/podcasts');
const retention = require('./lib/retention');

async function purgeExpiredStories() {
  const r = db.prepare("DELETE FROM stories WHERE expires_at < datetime('now')").run();
  return { deleted: r.changes };
}

async function purgeExpiredSessions() {
  // Sessions don't store an expires_at -- account-security.js computes
  // expiry live from created_at (absolute timeout) and last_seen_at (idle
  // timeout), configurable via SESSION_ABSOLUTE_DAYS/SESSION_IDLE_MINUTES.
  // Mirror that logic here with the same env-configurable defaults, rather
  // than duplicating a different, driftable set of constants. Revoked or
  // expired-either-way sessions carry no further security value and
  // otherwise accumulate forever.
  const idleMinutes = Math.max(15, Number(process.env.SESSION_IDLE_MINUTES) || 30);
  const absoluteDays = Math.max(1, Number(process.env.SESSION_ABSOLUTE_DAYS) || 30);
  const r = db.prepare(
    `DELETE FROM user_sessions
     WHERE revoked_at IS NOT NULL
        OR created_at < datetime('now', '-${absoluteDays} days')
        OR last_seen_at < datetime('now', '-${idleMinutes} minutes')`
  ).run();
  return { deleted: r.changes };
}

async function refreshFeeds() {
  const [n, p] = await Promise.all([
    news.refreshNews().catch(err => ({ error: err.message })),
    podcasts.refreshEpisodes().catch(err => ({ error: err.message })),
  ]);
  return { news: n, podcasts: p };
}

async function runRetentionSweep() {
  return retention.runOnce();
}

const TASKS = [
  ['purge_expired_stories', purgeExpiredStories],
  ['purge_expired_sessions', purgeExpiredSessions],
  ['refresh_feeds', refreshFeeds],
  ['retention_sweep', runRetentionSweep],
];

async function main() {
  const startedAt = new Date().toISOString();
  console.log(`[ops-agent] run started ${startedAt}`);
  const results = {};
  let failures = 0;

  for (const [name, fn] of TASKS) {
    try {
      results[name] = await fn();
      console.log(`[ops-agent] ${name} ok:`, JSON.stringify(results[name]));
    } catch (err) {
      failures++;
      results[name] = { error: err.message };
      console.error(`[ops-agent] ${name} FAILED:`, err.message);
    }
  }

  console.log(`[ops-agent] run finished. ${failures} task(s) failed.`);
  process.exitCode = failures ? 1 : 0;
}

main().catch(err => {
  console.error('[ops-agent] fatal:', err);
  process.exitCode = 1;
});
