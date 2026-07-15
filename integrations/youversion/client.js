const { VaultClient } = require('../../shared/vault-client');
const { isEnabled } = require('../../shared/feature-flags');
const { withRetry } = require('../../shared/retry');

const ALLOWED_TRANSLATIONS = new Set(['NIV', 'ESV', 'NLT', 'KJV']); // adjust per licensing agreement

class YouVersionClient {
  constructor({ vault = new VaultClient(), baseUrl = process.env.YOUVERSION_BASE_URL || 'https://api.youversion.example/v1' } = {}) {
    this.vault = vault;
    this.baseUrl = baseUrl;
  }

  async _authHeader() {
    const apiKey = await this.vault.getSecret('YOUVERSION_API_KEY');
    return { Authorization: `Bearer ${apiKey}` };
  }

  async getVerse(youversionId, translation = 'NIV') {
    if (!isEnabled('youversion.read')) {
      throw new FeatureDisabledError('youversion.read');
    }
    if (!ALLOWED_TRANSLATIONS.has(translation)) {
      throw new Error(`Translation ${translation} not in licensed set for this deployment`);
    }
    const headers = await this._authHeader();
    return withRetry(() => this._httpGet(`/verses/${youversionId}`, { translation }, headers));
  }

  async searchVerses(query, opts = {}) {
    if (!isEnabled('youversion.read')) throw new FeatureDisabledError('youversion.read');
    const headers = await this._authHeader();
    return withRetry(() => this._httpGet('/verses/search', { query, ...opts }, headers));
  }

  async markVerseEngaged(youversionUserId, youversionId) {
    if (!isEnabled('youversion.write')) throw new FeatureDisabledError('youversion.write');
    throw new Error('Write scope not yet verified against YouVersion partner contract - see adapter-interface.md');
  }

  async _httpGet(path, params, headers) {
    const url = new URL(this.baseUrl + path);
    Object.entries(params || {}).forEach(([k, v]) => v !== undefined && url.searchParams.set(k, v));
    const res = await fetch(url, { headers });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') || 1);
      const err = new Error('rate_limited');
      err.retryAfter = retryAfter;
      err.rateLimited = true;
      throw err;
    }
    if (!res.ok) throw new Error(`YouVersion API error ${res.status}: ${await res.text()}`);
    return res.json();
  }
}

class FeatureDisabledError extends Error {
  constructor(flag) {
    super(`Feature '${flag}' is disabled - enable in config/feature-flags.json after verifying contract/scopes`);
    this.name = 'FeatureDisabledError';
  }
}

module.exports = { YouVersionClient, FeatureDisabledError, ALLOWED_TRANSLATIONS };
