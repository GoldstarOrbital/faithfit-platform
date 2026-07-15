/**
 * In-process domain event bus. Same event names/shapes as the Kafka topics in
 * eventbus/topics.md, so this can be swapped for real Kafka later without touching
 * business logic — just replace this file's emit/on with a Kafka producer/consumer.
 */
const { EventEmitter } = require('events');
const bus = new EventEmitter();
bus.setMaxListeners(50);

function publish(topic, payload) {
  const event = { event_id: require('crypto').randomUUID(), occurred_at: new Date().toISOString(), ...payload };
  bus.emit(topic, event);
  bus.emit('*', topic, event);
  return event;
}

function subscribe(topic, handler) {
  bus.on(topic, handler);
}

module.exports = { publish, subscribe, bus };
