// Password hashing using Node's built-in crypto (scrypt) — no native-addon
// dependency (bcrypt/argon2 need compilation, which this build environment can't
// do; that's the same constraint that led to node:sqlite). scrypt is a memory-hard
// KDF suitable for password storage.
//
// Stored format:  scrypt$<N>$<saltHex>$<hashHex>
const { scryptSync, randomBytes, timingSafeEqual } = require('crypto');

const N = 16384;   // CPU/memory cost (2^14) — solid for a free-tier single process
const KEYLEN = 64;

function hashPassword(plain) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(plain), salt, KEYLEN, { N });
  return `scrypt$${N}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(plain, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const salt = Buffer.from(parts[2], 'hex');
  const expected = Buffer.from(parts[3], 'hex');
  let actual;
  try {
    actual = scryptSync(String(plain), salt, expected.length, { N: n });
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
