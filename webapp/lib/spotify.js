// Spotify connector — real listening data for two things: recommending
// Christian/worship playlists, and giving the morning verse (daily.js) a
// genuinely personalized signal instead of a generic one.
//
// Standard OAuth 2.0 Authorization Code flow (not PKCE — this is a
// confidential server-side client, same shape as strava.js). Registering a
// Spotify API application is free at https://developer.spotify.com/dashboard.
//
// Two scopes only: user-top-read (top artists, for genre affinity) and
// user-read-recently-played (recent tracks, for mood via audio features).
// Nothing is ever written back to a member's Spotify account.
'use strict';

const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';
const SCOPE = 'user-top-read user-read-recently-played';

function isConfigured() {
  return !!(process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET);
}

function basicAuthHeader() {
  const raw = `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`;
  return 'Basic ' + Buffer.from(raw).toString('base64');
}

function buildAuthorizationUrl({ redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: process.env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPE,
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(code, redirectUri) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`spotify_token_exchange_failed: ${data.error_description || data.error || res.status}`);
  return data; // { access_token, refresh_token, expires_in, scope }
}

async function refreshTokens(refreshToken) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: basicAuthHeader(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`spotify_refresh_failed: ${data.error_description || data.error || res.status}`);
  // Spotify does not always issue a new refresh token on refresh -- keep the
  // old one when it doesn't, or the next refresh would have nothing to use.
  return { ...data, refresh_token: data.refresh_token || refreshToken };
}

async function apiGet(accessToken, path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`spotify_api_failed:${path}:${res.status}`);
  return res.json();
}

const WORSHIP_GENRE_HINTS = ['christian', 'worship', 'gospel', 'ccm', 'praise'];

/**
 * A cached-friendly summary of what this member has actually been
 * listening to: a mood bucket from real audio-feature averages, their top
 * genres, and whether those genres already skew toward Christian/worship
 * music. Never track-level detail, and never a claim about how the member
 * feels -- only what Spotify's own acoustic analysis measured.
 */
async function computeTaste(accessToken) {
  const [topArtists, recent] = await Promise.all([
    apiGet(accessToken, '/me/top/artists?time_range=short_term&limit=20').catch(() => ({ items: [] })),
    apiGet(accessToken, '/me/player/recently-played?limit=30').catch(() => ({ items: [] })),
  ]);

  const genres = (topArtists.items || []).flatMap(a => a.genres || []);
  const topGenres = [...new Set(genres)].slice(0, 8);
  const worshipAffinity = topGenres.some(g => WORSHIP_GENRE_HINTS.some(hint => g.toLowerCase().includes(hint)));

  const trackIds = [...new Set((recent.items || []).map(i => i.track?.id).filter(Boolean))].slice(0, 50);
  let avgValence = null, avgEnergy = null;
  if (trackIds.length) {
    try {
      const features = await apiGet(accessToken, `/audio-features?ids=${trackIds.join(',')}`);
      const valid = (features.audio_features || []).filter(Boolean);
      if (valid.length) {
        avgValence = valid.reduce((s, f) => s + f.valence, 0) / valid.length;
        avgEnergy = valid.reduce((s, f) => s + f.energy, 0) / valid.length;
      }
    } catch { /* audio-features is best-effort; mood just stays null */ }
  }

  let mood = 'steady';
  if (avgValence != null && avgEnergy != null) {
    if (avgEnergy >= 0.6 && avgValence >= 0.5) mood = 'energized';
    else if (avgValence < 0.4) mood = 'heavy';
    else if (avgEnergy < 0.4 && avgValence >= 0.5) mood = 'reflective';
  }

  return { mood, topGenres, worshipAffinity, avgValence, avgEnergy };
}

module.exports = {
  isConfigured, buildAuthorizationUrl, exchangeCodeForTokens, refreshTokens, computeTaste,
};
