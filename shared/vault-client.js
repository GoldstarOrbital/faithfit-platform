/**
 * Minimal secrets-vault abstraction.
 * In production this wraps HashiCorp Vault / AWS Secrets Manager / GCP Secret Manager.
 * Locally it falls back to process.env so services run without a real vault.
 */
class VaultClient {
  constructor({ backend = process.env.VAULT_BACKEND || 'env' } = {}) {
    this.backend = backend;
  }

  async getSecret(key) {
    if (this.backend === 'env') {
      const val = process.env[key];
      if (!val) throw new Error(`Secret ${key} not found in env (dev fallback). Configure real vault in prod.`);
      return val;
    }
    throw new Error(`Vault backend '${this.backend}' not implemented in this stub - wire to real vault SDK.`);
  }
}

module.exports = { VaultClient };
