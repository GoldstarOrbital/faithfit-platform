'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../lib/companion.js'), 'utf8');
let calls = 0, clock = 1000, valid = true;
const context = {
  Date: {now: () => clock},
  resolveRef: async reference => ({reference, text:'canonical test fixture'}),
  gloo: {
    isConfigured: () => true,
    chat: async options => {
      assert.equal(options.kind, 'verse_companion');
      assert.equal(options.cache, true);
      calls++;
      return {text:'explanation fixture', key:'test-key', model:'test-model'};
    },
    verifyRefs: async () => ({ok:valid,verified:[],rejected:[]}),
    evictCache: () => {},
  },
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const verifiedVerseAnswers'), source.indexOf('async function askBibleQuestion')), context);
(async () => {
  const request = {userId:'member-a',reference:'John 3:16',question:'Explain its context.',tradition:'a',versionId:206};
  assert.equal((await context.askAboutVerse(request)).model, 'test-model');
  assert.equal((await context.askAboutVerse(request)).cached, true);
  assert.equal(calls,1,'repeat uses fully verified cache');
  await context.askAboutVerse({...request,userId:'member-b'});
  await context.askAboutVerse({...request,versionId:207});
  await context.askAboutVerse({...request,tradition:'b'});
  assert.equal(calls,4,'member, version and tradition isolate cached answers');
  clock += 16 * 60 * 1000;
  await context.askAboutVerse(request);
  assert.equal(calls,5,'expired answer is reverified');
  valid = false;
  const failing = {...request,question:'Unverifiable answer fixture'};
  assert.equal(await context.askAboutVerse(failing),null);
  assert.equal(await context.askAboutVerse(failing),null);
  assert.equal(calls,9,'failed verification is never cached');
  console.log('Verse companion: Gloo path, verified-only cache, isolation, expiry and failure retry passed.');
})().catch(error => {console.error(error);process.exitCode=1;});
