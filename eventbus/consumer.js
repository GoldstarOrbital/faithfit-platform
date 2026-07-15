const { Kafka } = require('kafkajs');

class EventConsumer {
  constructor({ groupId, clientId = groupId, brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',') }) {
    this.kafka = new Kafka({ clientId, brokers });
    this.consumer = this.kafka.consumer({ groupId });
  }

  async subscribeAndRun(topics, handler) {
    await this.consumer.connect();
    await this.consumer.subscribe({ topics, fromBeginning: false });
    await this.consumer.run({
      eachMessage: async ({ topic, message }) => {
        const event = JSON.parse(message.value.toString());
        await handler(topic, event);
      },
    });
  }

  async disconnect() {
    await this.consumer.disconnect();
  }
}

module.exports = { EventConsumer };
