const { Kafka } = require('kafkajs');
const crypto = require('crypto');

class EventProducer {
  constructor({ clientId = 'faithfit-service', brokers = (process.env.KAFKA_BROKERS || 'localhost:9092').split(',') } = {}) {
    this.kafka = new Kafka({ clientId, brokers });
    this.producer = this.kafka.producer();
    this.connected = false;
  }

  async connect() {
    if (!this.connected) {
      await this.producer.connect();
      this.connected = true;
    }
  }

  async publish(topic, payload) {
    await this.connect();
    const event = { event_id: crypto.randomUUID(), occurred_at: new Date().toISOString(), ...payload };
    await this.producer.send({ topic, messages: [{ key: payload.user_id || event.event_id, value: JSON.stringify(event) }] });
    return event;
  }

  async disconnect() {
    if (this.connected) await this.producer.disconnect();
    this.connected = false;
  }
}

module.exports = { EventProducer };
