const { VaultClient } = require('../../shared/vault-client');
const { isEnabled } = require('../../shared/feature-flags');
const { withRetry } = require('../../shared/retry');

class GlooClient {
  constructor({ vault = new VaultClient(), baseUrl = process.env.GLOO_BASE_URL || 'https://api.gloo.example/v1' } = {}) {
    this.vault = vault;
    this.baseUrl = baseUrl;
  }

  async _authHeader() {
    const apiKey = await this.vault.getSecret('GLOO_API_KEY');
    return { Authorization: `Bearer ${apiKey}` };
  }

  async getChurch(glooChurchId) {
    if (!isEnabled('gloo.read')) throw new Error("Feature 'gloo.read' disabled");
    const headers = await this._authHeader();
    return withRetry(() => this._httpGet(`/churches/${glooChurchId}`, headers));
  }

  async getGroup(glooGroupId) {
    if (!isEnabled('gloo.read')) throw new Error("Feature 'gloo.read' disabled");
    const headers = await this._authHeader();
    return withRetry(() => this._httpGet(`/groups/${glooGroupId}`, headers));
  }

  async syncGroupMembers(glooGroupId) {
    if (!isEnabled('gloo.read')) throw new Error("Feature 'gloo.read' disabled");
    const headers = await this._authHeader();
    return withRetry(() => this._httpGet(`/groups/${glooGroupId}/members`, headers));
  }

  async createGroupPost(glooGroupId, payload) {
    if (!isEnabled('gloo.write')) throw new Error("Feature 'gloo.write' disabled");
    throw new Error('Write scope not yet verified against Gloo partner contract');
  }

  async _httpGet(path, headers) {
    const res = await fetch(this.baseUrl + path, { headers });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') || 1);
      const err = new Error('rate_limited');
      err.retryAfter = retryAfter;
      err.rateLimited = true;
      throw err;
    }
    if (!res.ok) throw new Error(`Gloo API error ${res.status}: ${await res.text()}`);
    return res.json();
  }
}

module.exports = { GlooClient };
