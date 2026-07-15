const { hasBiometricConsent } = require('../consent');
const { normalizeToBiometricRow } = require('../normalize');
const { isEnabled } = require('../../shared/feature-flags');

/** Receives batched HealthKit samples pushed from the iOS app (via wearable-ingest service). */
async function ingestHealthKitBatch(db, { userId, samples }) {
  if (!isEnabled('wearable.healthkit')) throw new Error("Feature 'wearable.healthkit' disabled");
  if (!(await hasBiometricConsent(db, userId))) throw new Error('User has not granted biometric_ingest consent');

  return samples.map(s => normalizeToBiometricRow({
    userId, time: s.timestamp, heartRate: s.heartRate, hrv: s.hrv, steps: s.steps,
    movement: s.movement, gps: s.location, stressLevel: s.stressLevel,
  }));
}

module.exports = { ingestHealthKitBatch };
