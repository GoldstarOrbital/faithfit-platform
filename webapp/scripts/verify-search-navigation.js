'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const pending = [];
const box = { innerHTML: '', isConnected: true, dataset: {}, querySelectorAll: () => [] };
const scope = {
  document: { getElementById: () => box },
  api: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
  state: { me: { user: { id: 'self' } } }, SEARCH_ICONS: {},
  escapeHtml: value => String(value).replaceAll('<','&lt;'),
};
vm.createContext(scope);
vm.runInContext(source.slice(source.indexOf('async function runSearch(q)'), source.indexOf('function openSearchResult(')), scope);
const response = title => ({ total: 1, groups: [{ type: 'people', label: 'People', items: [{ id: title, title }] }] });
async function main() {
  const first = scope.runSearch('old');
  const second = scope.runSearch('new');
  pending[1].resolve(response('new')); await second;
  pending[0].resolve(response('old')); await first;
  assert.ok(box.innerHTML.includes('new') && !box.innerHTML.includes('old'));
  const third = scope.runSearch('slow');
  await scope.runSearch('');
  pending[2].resolve(response('slow')); await third;
  assert.ok(box.innerHTML.includes('Keep typing'));
  const fourth = scope.runSearch('error');
  box.isConnected = false; const before = box.innerHTML;
  pending[3].reject(new Error('offline')); await fourth;
  assert.equal(box.innerHTML, before);
  box.isConnected = true; box.dataset.messageMode = '1';
  const fifth = scope.runSearch('name');
  pending[4].resolve({ total: 3, groups: [
    { type: 'people', label: 'People', items: [{ id: 'SELF', title: 'My account' }, { id: 'friend', title: 'Friend' }] },
    { type: 'posts', label: 'Posts', items: [{ id: 'post', title: 'Unrelated post' }] },
  ] }); await fifth;
  assert.ok(box.innerHTML.includes('Friend'));
  assert.ok(!box.innerHTML.includes('My account') && !box.innerHTML.includes('Unrelated post'));
  assert.match(source, /id="dm-new"/);
  assert.match(source, /openSearch\(\{ messageMode: true \}\)/);
  console.log('Search navigation: stale results, cleared queries, detached error handlers, and DM people filtering passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
