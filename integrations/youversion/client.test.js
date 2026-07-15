const test = require('node:test');
const assert = require('node:assert');
const { YouVersionClient, FeatureDisabledError } = require('./client');

test('getVerse throws FeatureDisabledError when youversion.read flag is off (default)', async () => {
  const client = new YouVersionClient();
  await assert.rejects(() => client.getVerse('jhn.3.16'), FeatureDisabledError);
});
