const { isEnabled } = require('../../../../shared/feature-flags');
const { VaultClient } = require('../../../../shared/vault-client');

/** Thin APNs (Apple Push Notification service) sender stub. */
class APNsChannel {
  constructor({ vault = new VaultClient() } = {}) { this.vault = vault; }

  async send(deviceToken, { title, body, data }) {
    if (!isEnabled('notifications.push')) {
      console.log('[apns] push disabled by feature flag, skipping send', { deviceToken, title });
      return { skipped: true };
    }
    const authKey = await this.vault.getSecret('APNS_AUTH_KEY');
    // TODO: wire real APNs HTTP/2 client (e.g. node-apn / jsonwebtoken-signed provider requests)
    console.log('[apns] would send', { deviceToken, title, body, data, authKeyPresent: !!authKey });
    return { sent: true };
  }
}

module.exports = { APNsChannel };
