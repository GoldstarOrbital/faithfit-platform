/**
 * Entry-point dispatcher for the two Railway services that share this repo.
 *
 * Both faithfit-demo (the web app) and ops-agent (the maintenance cron)
 * build from the same webapp/ directory and package.json, so they need
 * different start commands. That was previously set via each service's
 * dashboard "Custom Start Command" field -- which turned out not to be
 * durable: a fresh deploy on ops-agent silently reverted to `npm start`
 * (server.js), and it crashed immediately because it has none of the web
 * service's required env vars (SESSION_SECRET, etc).
 *
 * This removes that dependency entirely. RAILWAY_SERVICE_NAME is injected
 * automatically by Railway on every deploy of every service -- it isn't a
 * setting that can be left unset or silently reset the way a dashboard
 * field can. `npm start` now always resolves to the right entry point for
 * whichever service is actually running it.
 */
'use strict';

const serviceName = process.env.RAILWAY_SERVICE_NAME || '';

if (serviceName === 'ops-agent') {
  require('./ops-agent.js');
} else {
  // Default to the web app -- also correct for local dev, where
  // RAILWAY_SERVICE_NAME is unset.
  require('./server.js');
}
