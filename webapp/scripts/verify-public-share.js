'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'functioning-faith-public-share-'));
const port = 34000 + crypto.randomInt(1000);
process.env.DATA_DIR = dataDir;
process.env.SESSION_SECRET = 'public-share-contract-test-secret';
const db = require('../lib/db');

const userId = crypto.randomUUID();
const publicPostId = crypto.randomUUID();
const privatePostId = crypto.randomUUID();
const workoutId = crypto.randomUUID();
db.prepare('INSERT INTO users(id,email,display_name) VALUES(?,?,?)').run(userId, 'share-test@functioningfaith.demo', 'Share Tester');
db.prepare('INSERT INTO workouts(id,user_id,type,start_time,end_time,distance_km) VALUES(?,?,?,?,?,?)')
  .run(workoutId, userId, 'Run', '2026-08-11T08:00:00.000Z', '2026-08-11T08:30:00.000Z', 5);
db.prepare('INSERT INTO posts(id,user_id,content,workout_id,visibility) VALUES(?,?,?,?,?)')
  .run(publicPostId, userId, 'A <strong>real</strong> 5K with the group.', workoutId, 'public');
db.prepare('INSERT INTO posts(id,user_id,content,visibility) VALUES(?,?,?,?)')
  .run(privatePostId, userId, 'This must never be public.', 'private');
db.close();

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('isolated server did not start');
}

async function main() {
  let child;
  try {
    child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), NODE_ENV: 'test' }, stdio: 'ignore', windowsHide: true });
    await waitForServer();
    const page = await fetch(`http://127.0.0.1:${port}/w/${publicPostId}`);
    const html = await page.text();
    assert.strictEqual(page.status, 200);
    assert.match(html, /og:title" content="Share Tester&#39;s Run \| Functioning Faith"/);
    assert.match(html, /og:image" content="https:\/\/faithfit-demo-production\.up\.railway\.app\/w\//);
    assert.ok(!html.includes('<strong>real</strong>'), 'metadata must HTML-escape member content');
    assert.ok(!html.includes('{{SHARE_'), 'rendered public shares must not expose template placeholders');

    const card = await fetch(`http://127.0.0.1:${port}/w/${publicPostId}/card.svg`);
    assert.strictEqual(card.status, 200);
    assert.match(card.headers.get('content-type') || '', /image\/svg\+xml/);
    assert.match(await card.text(), /Share Tester completed a Run/);

    const privatePage = await fetch(`http://127.0.0.1:${port}/w/${privatePostId}`);
    assert.strictEqual(privatePage.status, 404);
    assert.ok(!(await privatePage.text()).includes('This must never be public.'));
    console.log(JSON.stringify({ crawler_metadata: true, preview_card: true, public_only: true, content_escaped: true }));
  } finally {
    if (child && !child.killed) child.kill();
    await new Promise(resolve => setTimeout(resolve, 150));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
