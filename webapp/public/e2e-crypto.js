/**
 * DM end-to-end encryption.
 *
 * Each device generates an ECDH P-256 keypair the first time it's needed.
 * The public half is uploaded to the server (POST /dms/keys) so other
 * people's clients can find it; the private half is stored only in this
 * browser's localStorage and is never sent anywhere. To read a message, a
 * client derives a shared AES-GCM key from (my private key, their public
 * key) via ECDH -- the same shared secret both sides land on without either
 * one transmitting it. The server stores and relays only ciphertext.
 *
 * The storage key is scoped by user id (setIdentity, below), not shared
 * across accounts. Without that, signing into a second account in the same
 * browser -- a shared or test device -- would reuse the first account's
 * keypair and silently publish it as the second account's public key too.
 *
 * Known limitation, stated plainly: the private key lives in localStorage,
 * not a hardware-backed keystore, so it is only as safe as this origin is
 * from XSS, and it is single-device -- opening a conversation on a second
 * browser generates a second keypair that cannot read messages encrypted to
 * the first. Both are standard tradeoffs of browser-based E2E without a
 * dedicated key-backup protocol, not oversights.
 */
'use strict';

window.FFCrypto = (function () {
  const ALG = { name: 'ECDH', namedCurve: 'P-256' };

  let userId = null;
  let keyPairPromise = null;
  let sharedKeyCache = new Map(); // otherUserId -> Promise<CryptoKey|null>

  function b64(buf) {
    let s = '';
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function unb64(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** Call this once you know who is signed in. Switching identities (a
   *  different account signing into the same browser) drops any in-memory
   *  key state from the previous identity -- each account gets its own
   *  localStorage-backed keypair, keyed by user id. */
  function setIdentity(id) {
    if (id === userId) return;
    userId = id;
    keyPairPromise = null;
    sharedKeyCache = new Map();
  }

  function storageKey() {
    if (!userId) throw new Error('FFCrypto.setIdentity must be called before use');
    return 'ff-e2e-keypair-v2-' + userId;
  }

  async function ensureKeyPair() {
    if (keyPairPromise) return keyPairPromise;
    const key = storageKey();
    keyPairPromise = (async () => {
      const stored = localStorage.getItem(key);
      if (stored) {
        try {
          const jwk = JSON.parse(stored);
          const privateKey = await crypto.subtle.importKey('jwk', jwk.private, ALG, true, ['deriveKey']);
          return { privateKey, publicJwk: jwk.public };
        } catch (e) { /* corrupt/old entry -- regenerate below */ }
      }
      const pair = await crypto.subtle.generateKey(ALG, true, ['deriveKey']);
      const [privJwk, pubJwk] = await Promise.all([
        crypto.subtle.exportKey('jwk', pair.privateKey),
        crypto.subtle.exportKey('jwk', pair.publicKey),
      ]);
      localStorage.setItem(key, JSON.stringify({ private: privJwk, public: pubJwk }));
      return { privateKey: pair.privateKey, publicJwk: pubJwk };
    })();
    return keyPairPromise;
  }

  /** Uploads this device's public key, once per page load. Best-effort. */
  async function publishPublicKey(apiFn) {
    try {
      const { publicJwk } = await ensureKeyPair();
      await apiFn('/dms/keys', { method: 'POST', body: { public_key: publicJwk } });
    } catch (e) { /* best-effort; sending will retry key lookup next time */ }
  }

  /** The AES-GCM key shared with one other person, derived and cached locally. */
  async function sharedKeyWith(otherUserId, apiFn) {
    if (sharedKeyCache.has(otherUserId)) return sharedKeyCache.get(otherUserId);
    const p = (async () => {
      const { privateKey } = await ensureKeyPair();
      const res = await apiFn('/dms/keys/' + encodeURIComponent(otherUserId)).catch(() => null);
      if (!res || !res.public_key) return null;
      const theirPublicKey = await crypto.subtle.importKey('jwk', res.public_key, ALG, true, []);
      return crypto.subtle.deriveKey(
        { name: 'ECDH', public: theirPublicKey },
        privateKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
      );
    })();
    sharedKeyCache.set(otherUserId, p);
    return p;
  }

  async function encrypt(aesKey, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(plaintext));
    return b64(iv) + '.' + b64(ct);
  }

  async function decrypt(aesKey, blob) {
    const parts = String(blob || '').split('.');
    if (parts.length !== 2) throw new Error('malformed_ciphertext');
    const iv = unb64(parts[0]), ct = unb64(parts[1]);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ct);
    return new TextDecoder().decode(pt);
  }

  return { setIdentity, ensureKeyPair, publishPublicKey, sharedKeyWith, encrypt, decrypt };
})();
