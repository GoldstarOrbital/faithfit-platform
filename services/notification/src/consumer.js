const { EventConsumer } = require('../../../eventbus/consumer');
const { composeForEvent } = require('./composer');
const { APNsChannel } = require('./channels/apns');
const { WearablePushChannel } = require('./channels/wearable-push');

async function start({ db } = {}) {
  const consumer = new EventConsumer({ groupId: 'notification-service' });
  const apns = new APNsChannel();
  const wearablePush = new WearablePushChannel();

  await consumer.subscribeAndRun(['verse.triggered', 'badge.awarded', 'quest.progress'], async (topic, event) => {
    const message = composeForEvent(topic, event);
    // TODO: look up user's registered device token(s) from wearable_devices / a device_tokens table
    await apns.send('device-token-placeholder', message);
    await wearablePush.send(event.user_id, 'garmin', message);
    // TODO: persist to notifications table with delivered_at
  });
}

module.exports = { start };
if (require.main === module) start().catch(err => { console.error(err); process.exit(1); });
