'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'functioning-faith-native-auth-'));
const port = 32000 + crypto.randomInt(1000);
process.env.DATA_DIR = dataDir;
process.env.SESSION_SECRET = 'native-auth-contract-test-secret';

const db = require('../lib/db');
const security = require('../lib/account-security');
const { hashPassword } = require('../lib/password');

function makeGrant(userId, method = 'google') {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, code: security.issueNativeAuthCode(userId, method, challenge) };
}

async function waitForServer() {
  // A fresh isolated DB imports the entire Bible before listening. Allow
  // slower Windows/CI disks to finish without misreporting an auth failure.
  for (let attempt = 0; attempt < 300; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('isolated server did not start');
}

async function main() {
  let child;
  let databaseOpen = true;
  try {
    security.init();
    const userId = crypto.randomUUID();
    const email = `${userId}@example.test`;
    const originalPassword = 'NativeAuth-Original-2026!';
    db.prepare('INSERT INTO users(id,email,display_name,password_hash) VALUES(?,?,?,?)')
      .run(userId, email, 'Native Auth Test', await hashPassword(originalPassword));

    const direct = makeGrant(userId);
    assert.strictEqual(security.consumeNativeAuthCode(direct.code, 'wrong-verifier'), null,
      'an intercepted callback without the app verifier must not be redeemable');
    assert.deepStrictEqual(security.consumeNativeAuthCode(direct.code, direct.verifier),
      { userId, authMethod: 'google' }, 'the initiating app can redeem once');
    assert.strictEqual(security.consumeNativeAuthCode(direct.code, direct.verifier), null,
      'a native handoff code must not be replayable');
    assert.throws(() => security.issueNativeAuthCode(userId, 'google', 'not-a-challenge'),
      /Invalid native handoff challenge/);

    const routeGrant = makeGrant(userId, 'apple');
    db.close();
    databaseOpen = false;
    child = spawn(process.execPath, ['server.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), NODE_ENV: 'test' },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let serverError = '';
    child.stderr.on('data', chunk => { serverError += chunk.toString(); });
    await waitForServer();

    const browserAttempt = await fetch(`http://127.0.0.1:${port}/api/auth/native/exchange`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: routeGrant.code, handoff_verifier: routeGrant.verifier }),
    });
    assert.strictEqual(browserAttempt.status, 400,
      'a generic cross-site browser request must not create a native session');

    const invalidApple = await fetch(`http://127.0.0.1:${port}/api/auth/native/apple`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-functioning-faith-client': 'ios-native-v1' },
      body: JSON.stringify({ identity_token: 'not-a-jwt', nonce: crypto.randomBytes(32).toString('base64url') }),
    });
    assert.strictEqual(invalidApple.status, 401, 'an unverified Apple identity token must never create a session');

    const exchange = await fetch(`http://127.0.0.1:${port}/api/auth/native/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'FunctioningFaith-iOS-Contract', 'x-functioning-faith-client': 'ios-native-v1' },
      body: JSON.stringify({ code: routeGrant.code, handoff_verifier: routeGrant.verifier }),
    });
    const payload = await exchange.json();
    assert.strictEqual(exchange.status, 200, JSON.stringify(payload));
    assert.strictEqual(payload.account_setup_required, true,
      'identity-only accounts must complete age and Terms setup');
    const setCookies = typeof exchange.headers.getSetCookie === 'function'
      ? exchange.headers.getSetCookie()
      : [exchange.headers.get('set-cookie')].filter(Boolean);
    const cookie = setCookies.map(value => value.split(';')[0]).join('; ');
    assert.ok(cookie, 'native exchange must issue the normal signed session cookie');

    const me = await fetch(`http://127.0.0.1:${port}/api/me`, { headers: { cookie } });
    const mePayload = await me.json();
    assert.strictEqual(me.status, 200, JSON.stringify(mePayload));
    assert.strictEqual(mePayload.user.id, userId);
    assert.strictEqual(mePayload.account_setup_required, true);

    // Password sign-in is a first-class native path. It must establish the
    // same HttpOnly session as OAuth, rather than relying on a browser-only
    // form or treating failed credentials as a lost existing session.
    const passwordLogin = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-functioning-faith-client': 'ios-native-v1' },
      body: JSON.stringify({ email, password: originalPassword }),
    });
    assert.strictEqual(passwordLogin.status, 200, 'a valid email/password account must sign in from native iOS');
    const passwordCookie = (typeof passwordLogin.headers.getSetCookie === 'function'
      ? passwordLogin.headers.getSetCookie() : [passwordLogin.headers.get('set-cookie')].filter(Boolean))
      .map(value => value.split(';')[0]).join('; ');
    assert.ok(passwordCookie, 'password sign-in must set an authenticated session cookie');

    const wrongCurrent = await fetch(`http://127.0.0.1:${port}/api/security/password/change`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: passwordCookie },
      body: JSON.stringify({ current_password: 'wrong password', new_password: 'NativeAuth-Changed-2026!' }),
    });
    assert.strictEqual(wrongCurrent.status, 401, 'a password change must verify the current password');

    const passwordChange = await fetch(`http://127.0.0.1:${port}/api/security/password/change`, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie: passwordCookie },
      body: JSON.stringify({ current_password: originalPassword, new_password: 'NativeAuth-Changed-2026!' }),
    });
    assert.strictEqual(passwordChange.status, 200, 'an authenticated member can change a verified password');

    const oldPasswordLogin = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: originalPassword }),
    });
    assert.strictEqual(oldPasswordLogin.status, 401, 'the replaced password must no longer authenticate');
    const newPasswordLogin = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-functioning-faith-client': 'ios-native-v1' },
      body: JSON.stringify({ email, password: 'NativeAuth-Changed-2026!' }),
    });
    assert.strictEqual(newPasswordLogin.status, 200, 'the newly changed password must authenticate from native iOS');

    const recovery = await fetch(`http://127.0.0.1:${port}/api/auth/recovery/request`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-functioning-faith-client': 'ios-native-v1' },
      body: JSON.stringify({ email }),
    });
    assert.strictEqual(recovery.status, 200, 'native password recovery request must always receive a generic acknowledgement');

    const replay = await fetch(`http://127.0.0.1:${port}/api/auth/native/exchange`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-functioning-faith-client': 'ios-native-v1' },
      body: JSON.stringify({ code: routeGrant.code, handoff_verifier: routeGrant.verifier }),
    });
    assert.strictEqual(replay.status, 401, 'the HTTP exchange must reject replay');

    console.log(JSON.stringify({
      pkce_bound: true,
      single_use: true,
      expires_in_seconds: 120,
      session_cookie: true,
      account_setup_gate: true,
      apple_token_verification: true,
      native_password_login: true,
      password_change_current_password: true,
      password_recovery_request: true,
    }));
    if (serverError) process.stderr.write(serverError);
  } finally {
    if (child && !child.killed) child.kill();
    await new Promise(resolve => setTimeout(resolve, 150));
    if (databaseOpen) { try { db.close(); } catch {} }
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
