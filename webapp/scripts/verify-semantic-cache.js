'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'faithfit-semantic-cache-'));
process.env.DATA_DIR = tempDir;

const cache = require('../lib/semantic-cache');

const answer = { answer: 'God meets anxious hearts with his presence.', also: [], model: 'verified-test' };
assert.equal(cache.lookup({ kind: 'bible_answers', tradition: 'evangelical', versionId: 1, question: 'What does the Bible say about anxiety and fear?' }), null);
assert.equal(cache.store({ kind: 'bible_answers', tradition: 'evangelical', versionId: 1, question: 'What does the Bible say about anxiety and fear?' }, answer), true);
const hit = cache.lookup({ kind: 'bible_answers', tradition: 'evangelical', versionId: 1, question: 'What does Scripture say about worry and fear?' });
assert.ok(hit && hit.semanticCached, 'synonymous question should hit the verified semantic cache');
assert.equal(cache.lookup({ kind: 'bible_answers', tradition: 'catholic', versionId: 1, question: 'What does Scripture say about worry and fear?' }), null, 'traditions stay isolated');
assert.equal(cache.lookup({ kind: 'bible_answers', tradition: 'evangelical', versionId: 2, question: 'What does Scripture say about worry and fear?' }), null, 'translations stay isolated');
assert.equal(cache.lookup({ kind: 'bible_answers', tradition: 'evangelical', versionId: 1, question: 'Who was Nehemiah?' }), null, 'different intent must miss');
assert.equal(cache.store({ kind: 'verse_explanation', reference: 'Romans 8:28', tradition: 'evangelical', versionId: 1, question: 'What does this verse mean?' }, answer), true);
assert.ok(cache.lookup({ kind: 'verse_explanation', reference: 'Romans 8:28', tradition: 'evangelical', versionId: 1, question: 'Explain the meaning of this verse' }));
assert.equal(cache.lookup({ kind: 'verse_explanation', reference: 'Romans 8:29', tradition: 'evangelical', versionId: 1, question: 'Explain the meaning of this verse' }), null, 'passages stay isolated');
const metrics = cache.stats(7);
assert.ok(metrics.some((row) => row.kind === 'bible_answers' && row.hits >= 1 && row.misses >= 1));
console.log('semantic cache verification passed');
fs.rmSync(tempDir, { recursive: true, force: true });
