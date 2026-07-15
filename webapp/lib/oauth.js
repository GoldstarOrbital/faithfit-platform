// Generic OAuth 2.0 / OpenID Connect connector — dependency-free (Node core
// crypto + fetch only), so adding a new "Sign in with X" provider is just a
// config entry, not new code. Implements the Authorization Code flow with
// PKCE (RFC 7636) and full RS256 ID-token verification against the provider's
// published JWKS (signature, expiry, issuer, audience, nonce) — we do not
// trust an unverified token, per standard OIDC compliance practice.
//
// A provider is "configured" only when its required env vars are present; the
// UI only offers a provider's sign-in button when GET /api/auth/providers
// reports it configured, so nothing is ever silently broken or fake.
'use strict';

const crypto = require('crypto');

// ---- provider registry -----------------------------------------------
// clientSecret is optional for public clients using PKCE-only (not typical
// for web server flows, but supported). issuerMatch lets a provider whose
// issuer varies per-tenant (Microsoft) use a prefix check instead of equality.
const PROVIDERS = {
  google: {
    label: 'Google',
    kind: 'oidc',
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    issuer: 'https://accounts.google.com',
    scope: 'openid email profile',
    clientId: () => process.env.GOOGLE_CLIENT_ID,
    clientSecret: () => process.env.GOOGLE_CLIENT_SECRET,
  },
  microsoft: {
    label: 'Microsoft',
    kind: 'oidc',
    authorizationEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
    tokenEndpoint: 'https://login.microsoftonline.com/common/oauth2/v2.0/token',
    jwksUri: 'https://login.microsoftonline.com/common/discovery/v2.0/keys',
    issuerMatch: (iss) => /^https:\/\/login\.microsoftonline\.com\/[^/]+\/v2\.0$/.test(iss),
    scope: 'openid email profile',
    clientId: () => process.env.MICROSOFT_CLIENT_ID,
    clientSecret: () => process.env.MICROSOFT_CLIENT_SECRET,
  },
  apple: {
    label: 'Apple',
    kind: 'oidc',
    authorizationEndpoint: 'https://appleid.apple.com/auth/authorize',
    tokenEndpoint: 'https://appleid.apple.com/auth/token',
    jwksUri: 'https://appleid.apple.com/auth/keys',
    issuer: 'https://appleid.apple.com',
    scope: 'openid email name',
    responseMode: 'form_post', // Apple requires form_post when requesting `name`/`email` scopes
    clientId: () => process.env.APPLE_CLIENT_ID, // the "Services ID" identifier
    // Apple does not accept a static client secret — it must be a short-lived
    // ES256 JWT signed with your Sign in with Apple private key, minted fresh
    // per request. See mintAppleClientSecret() below.
    clientSecret: () => mintAppleClientSecret(),
  },
};

function isConfigured(name) {
  const p = PROVIDERS[name];
  if (!p) return false;
  try {
    const id = p.clientId();
    const secret = name === 'apple'
      ? !!(process.env.APPLE_KEY_ID && process.env.APPLE_TEAM_ID && process.env.APPLE_PRIVATE_KEY)
      : !!p.clientSecret();
    return !!id && secret;
  } catch { return false; }
}

function listConfiguredProviders() {
  return Object.keys(PROVIDERS).filter(isConfigured).map(name => ({ name, label: PROVIDERS[name].label }));
}

// ---- Apple's JWT-as-client-secret (ES256, signed with your private key) ----
function mintAppleClientSecret() {
  const { APPLE_KEY_ID, APPLE_TEAM_ID, APPLE_CLIENT_ID, APPLE_PRIVATE_KEY } = process.env;
  if (!APPLE_KEY_ID || !APPLE_TEAM_ID || !APPLE_CLIENT_ID || !APPLE_PRIVATE_KEY) return null;
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: APPLE_KEY_ID };
  const payload = { iss: APPLE_TEAM_ID, iat: now, exp: now + 300, aud: 'https://appleid.apple.com', sub: APPLE_CLIENT_ID };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  // Apple's private key is distributed as PKCS#8 PEM (the .p8 file contents).
  const key = crypto.createPrivateKey(APPLE_PRIVATE_KEY.replace(/\\n/g, '\n'));
  const sig = crypto.sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${b64url(sig)}`;
}

// ---- base64url helpers ----
function b64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

// ---- PKCE ----
function generatePkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function buildAuthorizationUrl(providerName, { redirectUri, state, nonce, codeChallenge }) {
  const p = PROVIDERS[providerName];
  if (!p) throw new Error(`unknown_provider:${providerName}`);
  const clientId = p.clientId();
  if (!clientId) throw new Error(`provider_not_configured:${providerName}`);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: p.scope,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  if (p.responseMode) params.set('response_mode', p.responseMode);
  return `${p.authorizationEndpoint}?${params.toString()}`;
}

async function exchangeCodeForTokens(providerName, { code, redirectUri, codeVerifier }) {
  const p = PROVIDERS[providerName];
  const clientId = p.clientId();
  const clientSecret = p.clientSecret();
  if (!clientId || !clientSecret) throw new Error(`provider_not_configured:${providerName}`);
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
    code_verifier: codeVerifier,
  });
  const res = await fetch(p.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`token_exchange_failed: ${data.error || res.status}`);
  return data; // { access_token, id_token, refresh_token?, expires_in, ... }
}

// ---- JWKS fetch + cache (per provider, 10 min TTL) ----
const jwksCache = new Map(); // provider -> { keys, fetchedAt }
async function getJwks(providerName) {
  const cached = jwksCache.get(providerName);
  if (cached && Date.now() - cached.fetchedAt < 10 * 60 * 1000) return cached.keys;
  const p = PROVIDERS[providerName];
  const res = await fetch(p.jwksUri);
  if (!res.ok) throw new Error(`jwks_fetch_failed:${res.status}`);
  const { keys } = await res.json();
  jwksCache.set(providerName, { keys, fetchedAt: Date.now() });
  return keys;
}

// ---- ID token verification (RS256 only) ----
// Verifies signature against the provider's live JWKS, plus exp/iss/aud/nonce.
// Never trusts a token's claims without a passing signature check first.
async function verifyIdToken(providerName, idToken, { nonce } = {}) {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('malformed_id_token');
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(b64urlDecode(headerB64).toString('utf8'));
  const payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error(`unsupported_alg:${header.alg}`);

  const keys = await getJwks(providerName);
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('signing_key_not_found');

  const publicKey = crypto.createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' });
  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`);
  const signature = b64urlDecode(sigB64);
  const valid = crypto.verify('RSA-SHA256', signingInput, publicKey, signature);
  if (!valid) throw new Error('invalid_signature');

  const p = PROVIDERS[providerName];
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new Error('token_expired');
  const issOk = p.issuerMatch ? p.issuerMatch(payload.iss) : payload.iss === p.issuer;
  if (!issOk) throw new Error('issuer_mismatch');
  const clientId = p.clientId();
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(clientId)) throw new Error('audience_mismatch');
  if (nonce && payload.nonce !== nonce) throw new Error('nonce_mismatch');

  return payload; // includes sub, email, email_verified, name, ...
}

module.exports = {
  PROVIDERS, isConfigured, listConfiguredProviders,
  generatePkce, buildAuthorizationUrl, exchangeCodeForTokens, verifyIdToken,
  b64url, b64urlDecode, // exported for tests
};
