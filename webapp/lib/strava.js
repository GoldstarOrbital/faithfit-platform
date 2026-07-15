// Strava connector — real device/wearable activity sync. Strava aggregates data
// from most GPS watches and fitness wearables (Garmin, Apple Watch, Coros,
// Suunto, Wahoo, etc.), so connecting Strava is the practical, zero-cost way to
// pull real wearable-recorded activity into FaithFit without registering (and
// paying for, in Apple's case) a developer account with every individual
// hardware vendor. Registering a Strava API application is free at
// https://www.strava.com/settings/api.
//
// Plain OAuth 2.0 (not OIDC) — no ID token, just an access/refresh token pair
// used as a Bearer credential against Strava's REST API.
'use strict';

const AUTH_URL = 'https://www.strava.com/oauth/authorize';
const TOKEN_URL = 'https://www.strava.com/oauth/token';
const API_BASE = 'https://www.strava.com/api/v3';

function isConfigured() {
  return !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);
}

function buildAuthorizationUrl({ redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code, grant_type: 'authorization_code',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`strava_token_exchange_failed: ${data.message || res.status}`);
  return data; // { access_token, refresh_token, expires_at, athlete }
}

async function refreshTokens(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: refreshToken, grant_type: 'refresh_token',
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`strava_refresh_failed: ${data.message || res.status}`);
  return data;
}

async function fetchRecentActivities(accessToken, { perPage = 30 } = {}) {
  const res = await fetch(`${API_BASE}/athlete/activities?per_page=${perPage}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`strava_activities_fetch_failed:${res.status}`);
  return res.json();
}

// Map FaithFit's own activity taxonomy from Strava's activity `type`/`sport_type`.
const TYPE_MAP = {
  Run: 'Run', TrailRun: 'Trail Run', Walk: 'Walk', Hike: 'Hike', Ride: 'Cycle',
  MountainBikeRide: 'Cycle', GravelRide: 'Cycle', Swim: 'Swim', Rowing: 'Row',
  Elliptical: 'Elliptical', WeightTraining: 'Strength', Workout: 'Workout',
  Yoga: 'Yoga', Pilates: 'Pilates', RockClimbing: 'Climbing',
  AlpineSki: 'Skiing', NordicSki: 'Skiing', BackcountrySki: 'Skiing',
  Crossfit: 'HIIT', HighIntensityIntervalTraining: 'HIIT',
};
function mapActivityType(strava) {
  return TYPE_MAP[strava.sport_type] || TYPE_MAP[strava.type] || 'Workout';
}

// Decode Google's Encoded Polyline Algorithm Format (the format Strava's
// `summary_polyline` uses) into an array of [lat, lng] pairs — so an imported
// activity's real route can render on the same map used elsewhere in the app.
function decodePolyline(encoded) {
  if (!encoded) return [];
  let index = 0, lat = 0, lng = 0;
  const points = [];
  while (index < encoded.length) {
    let shift = 0, result = 0, byte;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

module.exports = { isConfigured, buildAuthorizationUrl, exchangeCodeForTokens, refreshTokens, fetchRecentActivities, mapActivityType, decodePolyline };
