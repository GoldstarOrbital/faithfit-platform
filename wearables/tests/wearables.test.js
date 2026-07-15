const test = require('node:test');
const assert = require('node:assert');
const { normalizeToBiometricRow } = require('../normalize');
const { hasBiometricConsent } = require('../consent');

test('normalizeToBiometricRow maps vendor fields to schema', () => {
  const row = normalizeToBiometricRow({ userId: 'u1', time: new Date('2026-01-01T00:00:00Z'), heartRate: 140, hrv: 55, steps: 200 });
  assert.strictEqual(row.user_id, 'u1');
  assert.strictEqual(row.heart_rate, 140);
  assert.strictEqual(row.time, '2026-01-01T00:00:00.000Z');
});

test('hasBiometricConsent fails closed with no db', async () => {
  const result = await hasBiometricConsent(null, 'u1');
  assert.strictEqual(result, false);
});
