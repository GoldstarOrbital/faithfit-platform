const { hasBiometricConsent } = require('../consent');
const { normalizeToBiometricRow } = require('../normalize');
const { isEnabled } = require('../../shared/feature-flags');
const { VaultClient } = require('../../shared/vault-client');
const { withRetry } = require('../../shared/retry');

/** Pulls Google Fit REST API data for a user (requires their OAuth token, stored via vault-backed token store). */
class GoogleFitAdapter {
  constructor({ vault = new VaultClient(), db } = {}) {
    this.vault = vault;
    this.db = db;
  }

  async syncUser(userId, oauthAccessToken) {
    if (!isEnabled('wearable.googlefit')) throw new Error("Feature 'wearable.googlefit' disabled");
    if (!(await hasBiometricConsent(this.db, userId))) throw new Error('User has not granted biometric_ingest consent');

    const dataset = await withRetry(() => this._fetchAggregate(oauthAccessToken));
    return dataset.map(point => normalizeToBiometricRow({
      userId, time: point.time, heartRate: point.heartRate, steps: point.steps,
    }));
  }

  async _fetchAggregate(accessToken) {
    const res = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ aggregateBy: [{ dataTypeName: 'com.google.heart_rate.bpm' }] }),
    });
    if (res.status === 429) { const e = new Error('rate_limited'); e.rateLimited = true; e.retryAfter = 2; throw e; }
    if (!res.ok) throw new Error(`Google Fit API error ${res.status}`);
    const json = await res.json();
    // TODO: parse real bucket/dataset response shape into { time, heartRate, steps }[]
    return [];
  }
}

module.exports = { GoogleFitAdapter };
