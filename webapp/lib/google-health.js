// Google Health connector — real wearable data (Fitbit, and anything else
// synced into a member's Google Health account). Google folded the Fitbit
// Web API into this product; connecting here is how a Fitbit's step count,
// heart rate, and sleep reach Functioning Faith without registering directly
// with Fitbit's own (now-migrating) developer program.
//
// Every URL, scope string, and field name below is taken verbatim from
// developers.google.com/health docs fetched while building this (not from
// memory of the older, unrelated Google Fit API, which used a different auth
// surface and a different resource model). Where the docs did not show a
// field or path segment explicitly, that is called out in a comment rather
// than guessed at — see the dataType segment names below.
//
// Standard OAuth 2.0 against Google's own authorization server (not a
// health.googleapis.com-specific auth flow):
//   authorize: https://accounts.google.com/o/oauth2/v2/auth
//   token:     https://oauth2.googleapis.com/token   (form-urlencoded, confirmed
//              from Google's own refresh-token curl example -- NOT JSON, which
//              is what trips people up coming from Strava-style APIs.)
'use strict';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://health.googleapis.com/v4';

// Read-only scopes, quoted verbatim from the setup guide's own authorization
// request example. Activity/fitness covers steps and exercise sessions;
// sleep is a separate scope Google splits out on its consent screen.
const SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
];

// dataType path segments for GET /v4/users/me/dataTypes/{dataType}/dataPoints.
// 'steps' is confirmed directly from Google's own example request URL. The
// others are the docs' own named examples of supported types but were not
// shown in a fully worked request -- if a sync run gets a 404 for one of
// these, that is the first thing to check against a live account, not a
// guess to silently patch over.
const DATA_TYPES = {
  steps: 'steps',
  exercise: 'exercise', // workout sessions -- start/end time, activity type
  sleep: 'sleep',
};

function isConfigured() {
  return !!(process.env.GOOGLE_HEALTH_CLIENT_ID && process.env.GOOGLE_HEALTH_CLIENT_SECRET);
}

function buildAuthorizationUrl({ redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_HEALTH_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline', // required to get a refresh_token back at all
    prompt: 'consent',      // forces the consent screen so a refresh_token is
                             // reissued even for a member who connected before
    scope: SCOPES.join(' '),
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`google_health_token_failed: ${data.error_description || data.error || res.status}`);
  return data; // { access_token, refresh_token?, expires_in, token_type, scope }
}

function exchangeCodeForTokens(code, redirectUri) {
  return tokenRequest({
    client_id: process.env.GOOGLE_HEALTH_CLIENT_ID,
    client_secret: process.env.GOOGLE_HEALTH_CLIENT_SECRET,
    code, redirect_uri: redirectUri, grant_type: 'authorization_code',
  });
}

function refreshTokens(refreshToken) {
  return tokenRequest({
    client_id: process.env.GOOGLE_HEALTH_CLIENT_ID,
    client_secret: process.env.GOOGLE_HEALTH_CLIENT_SECRET,
    refresh_token: refreshToken, grant_type: 'refresh_token',
  });
}

/**
 * List data points for one dataType in [sinceIso, untilIso). Filter syntax
 * (AIP-160, `{type}.interval.start_time >= "..."`) is quoted directly from
 * Google's own example request -- the filter walks the underlying proto
 * field path, which is a different (and, per Google's own docs, more deeply
 * nested) shape than the flattened startTime/endTime the JSON response
 * itself uses. Both of those facts are from the docs, not inferred from one
 * another.
 */
async function listDataPoints(accessToken, dataType, { sinceIso, untilIso, pageSize = 500 } = {}) {
  const segment = DATA_TYPES[dataType] || dataType;
  const filters = [];
  if (sinceIso) filters.push(`${segment}.interval.start_time >= "${sinceIso}"`);
  if (untilIso) filters.push(`${segment}.interval.start_time < "${untilIso}"`);
  const params = new URLSearchParams({ pageSize: String(pageSize) });
  if (filters.length) params.set('filter', filters.join(' AND '));

  const points = [];
  let pageToken;
  do {
    if (pageToken) params.set('pageToken', pageToken); else params.delete('pageToken');
    const res = await fetch(`${API_BASE}/users/me/dataTypes/${segment}/dataPoints?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`google_health_datapoints_failed:${res.status}:${segment}:${body.slice(0, 200)}`);
    }
    const data = await res.json();
    points.push(...(data.dataPoints || []));
    pageToken = data.nextPageToken || null;
  } while (pageToken && points.length < 5000); // hard cap: never let a paging bug loop forever
  return points;
}

/** users/me/dataTypes/steps/dataPoints -> [{date: 'YYYY-MM-DD', steps: N}], summed
 *  per calendar day from raw points rather than trusting a single rollup shape. */
function summariseSteps(points) {
  const byDay = new Map();
  for (const p of points) {
    const count = p?.steps?.count;
    const when = p?.startTime;
    if (!Number.isFinite(count) || !when) continue;
    const day = when.slice(0, 10);
    byDay.set(day, (byDay.get(day) || 0) + count);
  }
  return [...byDay.entries()].map(([date, steps]) => ({ date, steps })).sort((a, b) => a.date.localeCompare(b.date));
}

/** Exercise sessions map onto Functioning Faith's own workout model. */
function mapExercisePoint(point) {
  const ex = point?.exercise || {};
  return {
    externalId: point.name, // users/{user}/dataTypes/exercise/dataPoints/{id} -- unique per session
    startTime: point.startTime,
    endTime: point.endTime,
    activityType: ex.activityType || ex.exerciseType || null,
    calories: ex.energyBurnedKcal ?? null,
    avgHeartRate: ex.averageHeartRateBpm ?? null,
  };
}

// Functioning Faith's own activity vocabulary (routes/api.js ACTIVITY_TYPES).
// The docs fetched while building this did NOT show the exercise.activityType
// enum's actual string values, so this is a best-effort case-insensitive
// match against the names Google's older Fit API used for the same concept,
// not a confirmed mapping -- anything that doesn't match falls through to
// 'Workout' rather than being silently misfiled as something specific but
// wrong. Worth revisiting against a real connected account's real payloads.
// Order matters: more specific patterns must come before the generic ones
// they'd otherwise be swallowed by (e.g. "TRAIL_RUNNING" contains "running",
// so /trail.?run/ has to be checked before the bare /run/).
const ACTIVITY_GUESS = [
  [/trail.?run/i, 'Trail Run'], [/run|jog/i, 'Run'], [/walk/i, 'Walk'], [/hik/i, 'Hike'],
  [/bike|cycl/i, 'Cycle'], [/swim/i, 'Swim'], [/row/i, 'Row'], [/elliptical/i, 'Elliptical'],
  [/strength|weight/i, 'Strength'], [/hiit|interval/i, 'HIIT'], [/yoga/i, 'Yoga'],
  [/pilates/i, 'Pilates'], [/climb/i, 'Climbing'], [/pickleball/i, 'Pickleball'],
  [/tennis/i, 'Tennis'], [/basketball/i, 'Basketball'], [/ski/i, 'Skiing'],
];
function mapActivityType(raw) {
  if (!raw) return 'Workout';
  const hit = ACTIVITY_GUESS.find(([re]) => re.test(String(raw)));
  return hit ? hit[1] : 'Workout';
}

module.exports = {
  isConfigured, buildAuthorizationUrl, exchangeCodeForTokens, refreshTokens,
  listDataPoints, summariseSteps, mapExercisePoint, mapActivityType, DATA_TYPES, SCOPES,
};
