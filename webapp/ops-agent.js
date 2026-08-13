/**
 * Functioning Faith ops agent.
 *
 * A bounded, non-AI maintenance run -- not a copy of the web server, and
 * not an agent in the AI sense. It triggers the same chores the web
 * process already runs on its own setInterval timers (see lib/news.js,
 * lib/podcasts.js, lib/retention.js), just on a schedule that survives the
 * web dyno restarting.
 *
 * This talks to the running app over HTTPS (POST /api/admin/ops/run) --
 * it does NOT open the SQLite database file directly. Earlier versions of
 * this script did, on the assumption it could share the web service's
 * Railway volume. That assumption was wrong: a Railway volume attaches to
 * exactly one service, so running this as a genuinely separate service
 * with its own volume mount would mean a second, disconnected database, and
 * attempting to attach the *same* volume to two services detaches it from
 * whichever one had it -- for the live web service, that means losing its
 * database out from under it. Calling the app's own endpoint sidesteps
 * that entirely: this script needs no filesystem access and no volume,
 * only two environment variables.
 *
 * Required env vars:
 *   OPS_TARGET_URL   e.g. https://faithfit-demo-production.up.railway.app
 *   OPS_AGENT_TOKEN  must match the same variable on the web service
 *
 * Usage: `node ops-agent.js`. Exits 0 on success, logs and exits 1 on any
 * failure (network error, non-2xx, or the endpoint reporting a task
 * failed). Safe to run as often as you like -- every task on the other
 * end is idempotent.
 */
'use strict';

async function main() {
  const targetUrl = process.env.OPS_TARGET_URL;
  const token = process.env.OPS_AGENT_TOKEN;
  if (!targetUrl) throw new Error('OPS_TARGET_URL is not set');
  if (!token) throw new Error('OPS_AGENT_TOKEN is not set');

  const startedAt = new Date().toISOString();
  console.log(`[ops-agent] run started ${startedAt} -> ${targetUrl}`);

  const res = await fetch(new URL('/api/admin/ops/run', targetUrl), {
    method: 'POST',
    headers: { 'x-ops-agent-token': token },
    signal: AbortSignal.timeout(60_000),
  });

  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    console.error(`[ops-agent] request failed: HTTP ${res.status}`, body || '(no body)');
    process.exitCode = 1;
    return;
  }

  for (const [name, result] of Object.entries(body.results || {})) {
    console.log(`[ops-agent] ${name}:`, JSON.stringify(result));
  }
  console.log(`[ops-agent] run finished. ok=${body.ok}`);
  process.exitCode = body.ok ? 0 : 1;
}

main().catch(err => {
  console.error('[ops-agent] fatal:', err.message);
  process.exitCode = 1;
});
