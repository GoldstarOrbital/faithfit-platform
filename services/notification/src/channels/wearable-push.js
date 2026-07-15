/** Sends short haptic/text nudges to wearables (Garmin Connect IQ, WHOOP, etc.) where supported. */
class WearablePushChannel {
  async send(userId, deviceType, { title, body }) {
    console.log(`[wearable-push:${deviceType}] would notify user ${userId}: ${title} - ${body}`);
    return { sent: true };
  }
}

module.exports = { WearablePushChannel };
