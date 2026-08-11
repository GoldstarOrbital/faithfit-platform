'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'functioning-faith-pulse-'));
const port = 33000 + crypto.randomInt(1000);
process.env.DATA_DIR = dataDir;
process.env.SESSION_SECRET = 'group-pulse-contract-test-secret';
const db = require('../lib/db');
const security = require('../lib/account-security');
security.init();

const members = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const groupId = crypto.randomUUID();
const verseId = crypto.randomUUID();
for (const [index, id] of members.entries()) {
  db.prepare(`INSERT INTO users(id,email,display_name,date_of_birth,terms_version,terms_accepted_at)
    VALUES(?,?,?,?,?,datetime('now'))`).run(id, `pulse-${index}@functioningfaith.demo`, `Pulse Member ${index + 1}`, '2000-01-01', security.TERMS_VERSION);
}
db.prepare('INSERT INTO groups(id,name,username,creator_id,created_at) VALUES(?,?,?,?,datetime(\'now\'))')
  .run(groupId, 'Pulse Test Group', `pulse-${crypto.randomBytes(4).toString('hex')}`, members[0]);
db.prepare("INSERT INTO group_members(group_id,user_id,role) VALUES(?,?,'admin')").run(groupId, members[0]);
db.prepare("INSERT INTO group_members(group_id,user_id,role) VALUES(?,?,'member')").run(groupId, members[1]);
db.prepare('INSERT INTO scripture_verses(id,reference,text,themes) VALUES(?,?,?,?)')
  .run(verseId, 'Isaiah 40:31', 'Those who wait for Yahweh will renew their strength.', 'strength endurance');
db.close();

function cookies(response) {
  const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
  return values.map(value => value.split(';')[0]).join('; ');
}
async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('isolated server did not start');
}
async function login(userId) {
  const response = await fetch(`http://127.0.0.1:${port}/api/session`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ user_id: userId }),
  });
  assert.strictEqual(response.status, 200);
  return cookies(response);
}
async function call(route, cookie, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    ...options, headers: { 'content-type': 'application/json', cookie, ...(options.headers || {}) },
  });
  return { response, body: await response.json() };
}

async function main() {
  let child;
  try {
    child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: 'ignore', windowsHide: true });
    await waitForServer();
    const [first, second, outsider] = await Promise.all(members.map(login));
    const day = new Date().toISOString().slice(0, 10);
    const created = await call(`/api/groups/${groupId}/pulse`, first, { method: 'POST', body: JSON.stringify({ kind: 'moved', note: 'Easy miles before work.', day }) });
    assert.strictEqual(created.response.status, 201, JSON.stringify(created.body));
    assert.strictEqual(created.body.verse_reference, 'Isaiah 40:31');

    const updated = await call(`/api/groups/${groupId}/pulse`, first, { method: 'POST', body: JSON.stringify({ kind: 'rested', note: 'Listening to my body.', day }) });
    assert.strictEqual(updated.response.status, 200, JSON.stringify(updated.body));
    const visible = await call(`/api/groups/${groupId}/pulse`, second);
    assert.strictEqual(visible.response.status, 200);
    assert.strictEqual(visible.body.checkins.length, 1, 'a daily pulse must update instead of multiplying');
    assert.strictEqual(visible.body.checkins[0].kind, 'rested');

    const self = await call(`/api/groups/${groupId}/pulse/${created.body.id}/encourage`, first, { method: 'POST', body: '{}' });
    assert.strictEqual(self.response.status, 400, 'self-encouragement must be rejected');
    const encouraged = await call(`/api/groups/${groupId}/pulse/${created.body.id}/encourage`, second, { method: 'POST', body: '{}' });
    assert.strictEqual(encouraged.response.status, 200);
    assert.strictEqual(encouraged.body.encouragement_count, 1);
    const duplicate = await call(`/api/groups/${groupId}/pulse/${created.body.id}/encourage`, second, { method: 'POST', body: '{}' });
    assert.strictEqual(duplicate.body.encouragement_count, 1, 'encouragement must be idempotent');
    const privateAttempt = await call(`/api/groups/${groupId}/pulse`, outsider);
    assert.strictEqual(privateAttempt.response.status, 403, 'non-members must not see a group pulse');

    console.log(JSON.stringify({ finite_daily_checkin: true, editable: true, group_private: true, no_self_reaction: true, idempotent_encouragement: true, scripture_attached: true }));
  } finally {
    if (child && !child.killed) child.kill();
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
