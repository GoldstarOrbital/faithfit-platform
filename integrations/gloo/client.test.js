const test = require('node:test');
const assert = require('node:assert');
const { GlooClient } = require('./client');

test('getChurch throws when gloo.read flag is off (default)', async () => {
  const client = new GlooClient();
  await assert.rejects(() => client.getChurch('church-1'));
});
