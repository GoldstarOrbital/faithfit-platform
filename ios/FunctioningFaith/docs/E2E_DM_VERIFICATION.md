# E2E DM cross-platform verification

**Why this exists:** Native `E2ECrypto.swift` must interoperate **byte-for-byte**
with `webapp/public/e2e-crypto.js`. A silent decrypt failure looks identical to
“everything is fine” until a member opens the other client.

Crypto choices that must match (do not “improve” without re-testing both sides):

1. ECDH P-256
2. **Raw** shared secret as AES-256 key material — **no HKDF**
3. AES-GCM with 12-byte IV
4. Ciphertext wire format: `base64(IV) + "." + base64(ciphertext||tag)` (standard base64, not base64url)
5. JWK public keys: `kty/crv/x/y` with **base64url** coordinates
6. Private key scoped **per account id** (Keychain service `app.functioningfaith.e2e`)

---

## Prerequisites

- Production (or staging that shares the same `/api/dms` implementation)
- Two accounts: **A** (iOS native) and **B** (web browser)
- Native Release or Debug build with `useMock = false`
- Web client on the same host the native `baseURL` points at

---

## Procedure

### A → B (native encrypt, web decrypt)

1. Sign in as **A** on iOS; sign in as **B** on web.
2. From A, open (or create) a DM thread with B.
3. Ensure A has published a public key (first encrypted send triggers
   `POST /api/dms/keys`).
4. Ensure B has a public key (open Messages on web and send any message, or
   trigger key publish the same way the web client does on first E2E send).
5. From **A (iOS)**, send a distinctive plaintext, e.g.  
   `native-probe-2026-08-20-alpha`.
6. On **B (web)**, open the same thread.
7. **Pass:** message body displays exactly `native-probe-2026-08-20-alpha`  
   **Fail:** blank, garbage, or “could not be decrypted”.

### B → A (web encrypt, native decrypt)

1. From **B (web)**, send `web-probe-2026-08-20-beta`.
2. On **A (iOS)**, open the thread (force refresh if needed).
3. **Pass:** exact plaintext shown  
   **Fail:** decrypt error or opaque ciphertext shown as text.

### No-key fallback

1. Use a third account **C** that has never published a key.
2. From A, message C.
3. **Pass:** message sends as non-E2E plaintext (server can scan links); both
   sides can read it. No crash.

### Account isolation

1. On the same iPhone, sign out A, sign in as D.
2. Confirm D does **not** reuse A’s Keychain keypair as its published identity
   (D should generate/publish its own JWK; messages to A’s peers stay sealed).

---

## Debugging failures

| Symptom | Likely cause |
|---|---|
| Both directions fail | One side using HKDF; IV length ≠ 12; base64 vs base64url mix-up on message body |
| Only web→native fails | Native JWK import rejecting `ext`/`key_ops` (should ignore extras; see `JWKDTO`) |
| Only native→web fails | Native encrypt combining nonce differently than `IV.ciphertext+tag` |
| Works once then not | Keychain write failed silently; new keypair next launch (see comment in `E2ECrypto.keyPair`) |
| 401 on key publish | Session cookie not retained in `URLSession.shared` |

Do **not** “fix” a failed decrypt by showing ciphertext to the member. Surface
the existing `CryptoError` copy and keep the sealed payload server-side.

---

## Sign-off

| Direction | Tester | Device / browser | Build / commit | Result |
|---|---|---|---|---|
| Native → Web | | | | |
| Web → Native | | | | |
| No-key fallback | | | | |
| Account isolation | | | | |
