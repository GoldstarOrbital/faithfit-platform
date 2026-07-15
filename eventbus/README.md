# Event bus (Kafka)

`producer.js` / `consumer.js` are thin kafkajs wrappers shared by all services.
See `topics.md` for the domain event catalog. Example producer usage:

```js
const { EventProducer } = require('../../eventbus/producer');
const producer = new EventProducer({ clientId: 'fitness-service' });
await producer.publish('workout.started', { user_id, workout_id, type, start_time });
```

Example consumer usage (see notification service `src/consumer.js` for a full example):

```js
const { EventConsumer } = require('../../eventbus/consumer');
const consumer = new EventConsumer({ groupId: 'notification-service' });
await consumer.subscribeAndRun(['verse.triggered', 'badge.awarded'], async (topic, event) => {
  // compose + deliver notification
});
```

Local dev: run Kafka via `docker-compose.yml` (kafka + zookeeper services included).
