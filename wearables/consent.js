/**
 * Consent gate - must be checked before ANY biometric ingestion, per spec section 3 (Wearables).
 * Backed by a simple consents table (add via migration: user_id, scope, granted_at, revoked_at).
 */
async function hasBiometricConsent(db, userId, scope = 'biometric_ingest') {
  if (!db) return false; // fail closed
  const { rows } = await db.query(
    `SELECT 1 FROM user_consents WHERE user_id = $1 AND scope = $2 AND revoked_at IS NULL LIMIT 1`,
    [userId, scope]
  );
  return rows.length > 0;
}

module.exports = { hasBiometricConsent };
