// End-to-end smoke test across everything today's commits touched, against a
// running server. Not a unit test: this is "does the app still work together".
// End-to-end smoke test against a RUNNING server, covering the paths this
// batch of work touched. Not part of CI: it needs a live server and it
// mutates data (it finishes by deleting the account it signed in as), so it is
// a thing to run deliberately against a scratch instance:
//
//   DATA_DIR=/tmp/smoke PORT=3470 node server.js &
//   node scripts/smoke-api.js
//
// Point it elsewhere with SMOKE_BASE. Never run it against production.
const BASE = process.env.SMOKE_BASE || 'http://localhost:3470';
let cookie = '';
const results = [];

async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  // cookie-session sets TWO cookies -- the session and its signature -- and
  // headers.get() joins them into one string, so taking split(';')[0] kept
  // only the session and dropped the signature. Every authenticated call then
  // 401'd, which looked like a broken app rather than a broken harness.
  const all = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  if (all.length) {
    const jar = new Map(cookie ? cookie.split('; ').map(c => [c.split('=')[0], c]) : []);
    for (const c of all) { const pair = c.split(';')[0]; jar.set(pair.split('=')[0], pair); }
    cookie = [...jar.values()].join('; ');
  }
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, headers: res.headers };
}
function check(name, ok, detail) { results.push({ name, ok, detail: detail || '' }); }

(async () => {
  // Auth
  const demo = await call('GET', '/api/auth/demo-users');
  const user = (demo.json?.users || demo.json)[0];
  const login = await call('POST', '/api/auth/demo', { user_id: user.id });
  check('demo sign-in', login.status === 200, `status ${login.status}`);

  // Feed
  const feed = await call('GET', '/api/feed?limit=10&media=deferred');
  check('feed loads', feed.status === 200 && Array.isArray(feed.json?.posts), `${feed.json?.posts?.length} posts`);
  // Corrected: the feed is cached, private and short-lived. What matters is
  // that it is private (never a shared proxy) and brief.
  const fc = feed.headers.get('cache-control') || '';
  check('feed cache is private and short', /private/.test(fc) && /max-age=(\d+)/.test(fc) && Number(fc.match(/max-age=(\d+)/)[1]) <= 60, fc);

  const forYou = await call('GET', '/api/feed/for-you?media=deferred');
  check('for-you feed loads', forYou.status === 200);

  // Scripture: caching, offline payload, the omitted-verse case
  const passage = await call('GET', '/api/bible/passage/John/3');
  check('scripture passage', passage.status === 200 && passage.json?.verses?.length === 36, `${passage.json?.verses?.length} verses`);
  check('scripture cached a week', /max-age=604800/.test(passage.headers.get('cache-control') || ''), passage.headers.get('cache-control'));

  const missing = await call('GET', '/api/bible/passage/Habakkuk/99');
  check('absent chapter 404s uncached', missing.status === 404 && missing.headers.get('cache-control') === 'no-store');

  const random = await call('GET', '/api/bible/random');
  check('random stays uncached', random.headers.get('cache-control') === 'no-store');

  const offline = await call('GET', '/api/bible/offline');
  const acts8 = offline.json?.books?.Acts?.['8'];
  check('offline bible complete', offline.json?.verses === 31202, `${offline.json?.verses} verses`);
  check('omitted verse is empty string not null', acts8 && acts8[36] === '' && acts8[35] && acts8[37],
    `36=${!!acts8?.[35]} 37="${acts8?.[36]}" 38=${!!acts8?.[37]}`);
  let anyNull = false;
  for (const chapters of Object.values(offline.json?.books || {}))
    for (const verses of Object.values(chapters))
      for (const t of verses) if (typeof t !== 'string') anyNull = true;
  check('no nulls anywhere in the bible payload', !anyNull);

  // Reels: must not block on third parties
  const t0 = Date.now();
  const reels = await call('GET', '/api/reels');
  check('reels responds fast', reels.status === 200 && Date.now() - t0 < 2000, `status ${reels.status}, ${Date.now() - t0}ms`);

  // Search
  const search = await call('GET', '/api/search?q=jo');
  check('search returns groups', search.status === 200 && (search.json?.groups?.length > 0),
    (search.json?.groups || []).map(g => g.type).join(','));

  // Workout -> feed
  const start = await call('POST', '/api/workouts/start', { type: 'Run' });
  const wid = start.json?.id;
  await new Promise(r => setTimeout(r, 1100));
  const stop = await call('POST', `/api/workouts/${wid}/stop`, { gps_distance_km: 7.5 });
  check('workout stops', stop.status === 200, `distance ${stop.json?.distance_km}`);
  check('distance validated', stop.json?.distance_km === 7.5, String(stop.json?.distance_km));

  // Abuse cases on the leaderboard columns
  const s2 = await call('POST', '/api/workouts/start', { type: 'Run' });
  const stop2 = await call('POST', `/api/workouts/${s2.json?.id}/stop`, { gps_distance_km: 999999 });
  check('absurd distance rejected', stop2.json?.distance_km === null, String(stop2.json?.distance_km));

  const manual = await call('POST', '/api/workouts/manual', { type: 'Run', duration_min: 99999999, distance_km: 500000 });
  // 201 Created is correct here; the status was my expectation being wrong.
  // What matters is what got stored: 500000 km and ~190 years of duration must
  // both be refused, since both feed ranked leaderboard metrics.
  check('manual entry accepted', manual.status === 201, `status ${manual.status}`);
  check('manual distance refused', manual.json?.distance_km == null, String(manual.json?.distance_km));
  check('manual duration clamped', (manual.json?.duration_sec ?? 0) <= 48 * 3600, String(manual.json?.duration_sec));

  await new Promise(r => setTimeout(r, 1200));
  const feed2 = await call('GET', '/api/feed?limit=10');
  const workoutPost = feed2.json?.posts?.find(p => p.workout_type === 'Run' && /7.5 km/.test(p.content || ''));
  check('workout reached the feed with a verse', !!workoutPost && !!workoutPost.verse_reference,
    workoutPost ? `${workoutPost.content} / ${workoutPost.verse_reference}` : 'not found');

  // Leaderboard must not be corrupted by the rejected values
  const lb = await call('GET', '/api/leaderboard?metric=distance_km&days=7');
  const mine = (lb.json?.entries || []).find(e => e.id === user.id || e.user_id === user.id);
  check('leaderboard sane after abuse attempts', !mine || mine.value < 1000, JSON.stringify(mine?.value));

  // Verse conversation -> feed
  const thread = await call('POST', '/api/verses/Psalms 23:4/thread', {});
  const tid = thread.json?.thread?.id;
  const refl = await call('POST', `/api/verses/threads/${tid}/reflections`, { content: 'Smoke test reflection.' });
  check('reflection posts', refl.status === 201, `status ${refl.status}`);
  await new Promise(r => setTimeout(r, 800));
  const feed3 = await call('GET', '/api/feed?limit=10');
  check('verse conversation reached the feed',
    !!feed3.json?.posts?.find(p => /Smoke test reflection/.test(p.content || '')));

  // Account deletion invalidates the session
  const del = await call('DELETE', '/api/me');
  check('account deletion', del.status === 200);
  const after = await call('GET', '/api/feed/for-you');
  check('session invalid after deletion', after.status === 401, `status ${after.status}`);

  const failed = results.filter(r => !r.ok);
  for (const r of results) console.log(`  ${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}${r.detail ? '  [' + r.detail + ']' : ''}`);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exitCode = failed.length ? 1 : 0;
})();
