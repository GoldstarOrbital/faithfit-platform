'use strict';

// Direct cloud connectors for providers that expose a public OAuth API. Garmin
// devices are supported through Strava today (the Garmin Health API requires a
// Garmin partner approval); this module keeps the normalized import contract the
// same when a direct Garmin credential is added later.
const PROVIDERS = {
  fitbit: {
    label: 'Fitbit',
    clientId: 'FITBIT_CLIENT_ID', clientSecret: 'FITBIT_CLIENT_SECRET',
    authUrl: 'https://www.fitbit.com/oauth2/authorize', tokenUrl: 'https://api.fitbit.com/oauth2/token',
    scope: 'activity heartrate sleep profile',
  },
  oura: {
    label: 'Oura Ring',
    clientId: 'OURA_CLIENT_ID', clientSecret: 'OURA_CLIENT_SECRET',
    authUrl: 'https://cloud.ouraring.com/oauth/authorize', tokenUrl: 'https://api.ouraring.com/oauth/token',
    scope: 'daily personal session',
  },
};

function provider(name) { return PROVIDERS[String(name || '').toLowerCase()] || null; }
function isConfigured(name) {
  const p = provider(name);
  return !!(p && process.env[p.clientId] && process.env[p.clientSecret]);
}
function buildAuthorizationUrl(name, { redirectUri, state }) {
  const p = provider(name);
  if (!p || !isConfigured(name)) throw new Error('wearable_not_configured');
  const params = new URLSearchParams({ response_type: 'code', client_id: process.env[p.clientId], redirect_uri: redirectUri, scope: p.scope, state });
  return `${p.authUrl}?${params.toString()}`;
}
async function exchangeCodeForTokens(name, code, redirectUri) {
  const p = provider(name);
  if (!p || !isConfigured(name)) throw new Error('wearable_not_configured');
  const basic = Buffer.from(`${process.env[p.clientId]}:${process.env[p.clientSecret]}`).toString('base64');
  const res = await fetch(p.tokenUrl, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, grant_type: 'authorization_code', redirect_uri: redirectUri, client_id: process.env[p.clientId] }).toString() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${name}_token_exchange_failed:${data.error || res.status}`);
  return data;
}
async function refreshTokens(name, refreshToken) {
  const p = provider(name);
  const basic = Buffer.from(`${process.env[p.clientId]}:${process.env[p.clientSecret]}`).toString('base64');
  const res = await fetch(p.tokenUrl, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: process.env[p.clientId] }).toString() });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${name}_refresh_failed:${data.error || res.status}`);
  return data;
}
async function apiGet(url, accessToken) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`wearable_api_failed:${res.status}`);
  return data;
}
function dateKey(daysAgo = 7) { const d = new Date(Date.now() - daysAgo * 86400000); return d.toISOString().slice(0, 10); }

async function fetchRecent(name, accessToken) {
  const start = dateKey(30); const end = dateKey(0);
  if (name === 'fitbit') {
    const activities = await apiGet(`https://api.fitbit.com/1/user/-/activities/list.json?afterDate=${start}&sort=asc&offset=0&limit=100`, accessToken);
    const sleep = await apiGet(`https://api.fitbit.com/1.2/user/-/sleep/date/${end}.json`, accessToken).catch(() => ({}));
    return { activities: activities.activities || [], sleep: sleep.sleep || [] };
  }
  if (name === 'oura') {
    const [activities, sleep, readiness] = await Promise.all([
      apiGet(`https://api.ouraring.com/v2/usercollection/daily_activity?start_date=${start}&end_date=${end}`, accessToken).catch(() => ({ data: [] })),
      apiGet(`https://api.ouraring.com/v2/usercollection/daily_sleep?start_date=${start}&end_date=${end}`, accessToken).catch(() => ({ data: [] })),
      apiGet(`https://api.ouraring.com/v2/usercollection/daily_readiness?start_date=${start}&end_date=${end}`, accessToken).catch(() => ({ data: [] })),
    ]);
    return { activities: activities.data || [], sleep: sleep.data || [], readiness: readiness.data || [] };
  }
  throw new Error('unsupported_wearable');
}
function normalizeActivity(name, item) {
  if (name === 'fitbit') return {
    externalId: String(item.logId || item.activityId || `${item.startTime}-${item.activityName}`),
    type: /run|jog/i.test(item.activityName || '') ? 'Run' : /walk/i.test(item.activityName || '') ? 'Walk' : /bike|cycle/i.test(item.activityName || '') ? 'Cycle' : 'Workout',
    start: new Date(item.startTime || Date.now()), durationSec: Math.round((item.duration || 0) / 1000), distanceKm: item.distance ? Number(item.distance) * (item.distanceUnit === 'Mile' ? 1.60934 : 1) : null,
    calories: item.calories || null, avgHr: item.averageHeartRate || null, maxHr: item.maxHeartRate || null, note: `Synced from Fitbit: ${item.activityName || 'activity'}`,
  };
  return {
    externalId: String(item.id), type: /cycling|bike/i.test(item.activity || '') ? 'Cycle' : /running|run/i.test(item.activity || '') ? 'Run' : 'Workout',
    start: new Date(item.day || item.timestamp || Date.now()), durationSec: Math.round(item.active_calories ? 0 : (item.total_calories || 0)), distanceKm: item.distance ? Number(item.distance) : null,
    calories: item.calories || item.active_calories || null, avgHr: item.average_heart_rate || null, maxHr: null, note: 'Synced from Oura Ring',
  };
}
function normalizeRecovery(name, payload) {
  const rows = [];
  if (name === 'fitbit') for (const s of payload.sleep || []) rows.push({ date: s.dateOfSleep, sleep_score: s.efficiency || null, sleep_sec: s.duration ? Math.round(s.duration / 1000) : null, raw: s });
  if (name === 'oura') {
    const byDay = new Map();
    for (const s of payload.sleep || []) byDay.set(s.day, { date: s.day, sleep_score: s.score || null, sleep_sec: s.total_sleep_duration || null, raw: s });
    for (const r of payload.readiness || []) { const row = byDay.get(r.day) || { date: r.day, raw: {} }; row.readiness_score = r.score || null; row.hrv = r.contributors?.hrv_balance || null; row.raw = { ...row.raw, readiness: r }; byDay.set(r.day, row); }
    rows.push(...byDay.values());
  }
  return rows;
}

module.exports = { PROVIDERS, provider, isConfigured, buildAuthorizationUrl, exchangeCodeForTokens, refreshTokens, fetchRecent, normalizeActivity, normalizeRecovery };
