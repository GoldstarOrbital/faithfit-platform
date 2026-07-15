const { hasBiometricConsent } = require('../consent');
const { normalizeToBiometricRow } = require('../normalize');
const { isEnabled } = require('../../shared/feature-flags');
const { withRetry } = require('../../shared/retry');

/**
 * Generic polling adapter template for vendors without real-time webhooks
 * (Garmin Connect, Fitbit, Oura, WHOOP). Instantiate per-vendor with a fetcher function.
 *
 * Usage:
 *   const garmin = new PollingAdapter({ flag: 'wearable.garmin', fetcher: fetchGarminSamples, db });
 *   await garmin.pollUser(userId, { accessToken });
 */
class PollingAdapter {
  constructor({ flag, fetcher, db, pollIntervalMs = 15 * 60 * 1000 }) {
    this.flag = flag;
    this.fetcher = fetcher; // async (userId, creds) -> raw vendor samples[]
    this.db = db;
    this.pollIntervalMs = pollIntervalMs;
  }

  async pollUser(userId, creds) {
    if (!isEnabled(this.flag)) throw new Error(`Feature '${this.flag}' disabled`);
    if (!(await hasBiometricConsent(this.db, userId))) throw new Error('User has not granted biometric_ingest consent');

    const rawSamples = await withRetry(() => this.fetcher(userId, creds));
    return rawSamples.map(s => normalizeToBiometricRow({
      userId, time: s.time, heartRate: s.heartRate, hrv: s.hrv, steps: s.steps, stressLevel: s.stressLevel,
    }));
  }

  /** Simple setInterval-based scheduler for local/dev; production should use a job queue (e.g. BullMQ / cron). */
  schedule(userId, creds, onBatch) {
    return setInterval(async () => {
      try {
        const rows = await this.pollUser(userId, creds);
        onBatch(rows);
      } catch (err) {
        console.error(`[polling:${this.flag}] error`, err.message);
      }
    }, this.pollIntervalMs);
  }
}

module.exports = { PollingAdapter };
