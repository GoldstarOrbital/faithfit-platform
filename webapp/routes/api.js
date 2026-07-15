const express = require('express');
const { randomUUID } = require('crypto');
const db = require('../lib/db');
const { publish, subscribe } = require('../lib/events');
const { runPipeline } = require('../lib/pipeline');
const { xpForEvent, levelForXp } = require('../lib/xp');
const { advanceQuestProgress } = require('../lib/quests');
const { badgeEligibility } = require('../lib/badges');
const { composeForEvent } = require('../lib/composer');
const { loadBibleData } = require('../lib/bible-load');

// Load real, public-domain Bible text (KJV/WEB) into bible_verses once at startup.
loadBibleData();

const router = express.Router();

// ---- auth (demo: pick a user, no password — this is a local demo, not production auth) ----
router.get('/users', (req, res) => {
  res.json(db.prepare(`
    SELECT id, display_name, bio_verse_ref, bio_verse_text, job, church, fitness_group, gym,
      CASE WHEN show_age = 1 THEN age ELSE NULL END AS age
    FROM users
  `).all());
});

router.post('/session', (req, res) => {
  const { user_id } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(user_id);
  if (!user) return res.status(404).json({ error: 'user_not_found' });
  req.session.userId = user.id;
  res.json({ ok: true, user });
});

router.get('/me', (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: 'not_signed_in' });
  const uid = req.session.userId;
  const userRow = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (!userRow) {
    // Stale session pointing at a user that no longer exists (e.g. DB was reset).
    // Clear it and bounce to sign-in instead of rendering a broken "undefined" profile.
    req.session = null;
    return res.status(401).json({ error: 'not_signed_in' });
  }
  const { password_hash, ...user } = userRow;
  const xp = db.prepare('SELECT * FROM user_xp WHERE user_id = ?').get(uid);
  const badges = db.prepare(`SELECT b.* FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = ?`).all(uid);
  const consents = db.prepare('SELECT scope FROM user_consents WHERE user_id = ? AND revoked_at IS NULL').all(uid).map(r => r.scope);
  const stats = {
    workouts: db.prepare("SELECT COUNT(*) c FROM workouts WHERE user_id = ? AND end_time IS NOT NULL").get(uid).c,
    total_calories: db.prepare("SELECT COALESCE(SUM(calories),0) c FROM workouts WHERE user_id = ?").get(uid).c,
    followers: db.prepare('SELECT COUNT(*) c FROM followers WHERE followee_id = ?').get(uid).c,
    following: db.prepare('SELECT COUNT(*) c FROM followers WHERE follower_id = ?').get(uid).c,
  };
  res.json({ user, xp, badges, consents, stats });
});

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'not_signed_in' });
  const exists = db.prepare('SELECT 1 FROM users WHERE id = ?').get(req.session.userId);
  if (!exists) {
    req.session = null;
    return res.status(401).json({ error: 'not_signed_in' });
  }
  next();
}

// ---- consent (privacy opt-in, per spec section 3) ----
router.post('/consent', requireAuth, (req, res) => {
  const { scope, granted } = req.body || {};
  if (!['biometric_ingest', 'scripture_personalization'].includes(scope)) {
    return res.status(400).json({ error: 'invalid_scope' });
  }
  if (granted) {
    const existing = db.prepare('SELECT * FROM user_consents WHERE user_id = ? AND scope = ? AND revoked_at IS NULL').get(req.session.userId, scope);
    if (!existing) db.prepare('INSERT INTO user_consents (id, user_id, scope) VALUES (?, ?, ?)').run(randomUUID(), req.session.userId, scope);
  } else {
    db.prepare("UPDATE user_consents SET revoked_at = datetime('now') WHERE user_id = ? AND scope = ? AND revoked_at IS NULL").run(req.session.userId, scope);
  }
  res.json({ ok: true });
});

// ---- feed ----
router.get('/feed', (req, res) => {
  const meId = req.session.userId;
  const posts = db.prepare(`
    SELECT p.id, p.content, p.created_at, p.user_id author_id, u.display_name author,
           w.type workout_type, w.calories, w.avg_hr, w.start_time, w.end_time, w.distance_km,
           v.reference verse_reference, v.text verse_text, v.youversion_id
    FROM posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN workouts w ON w.id = p.workout_id
    LEFT JOIN scripture_verses v ON v.id = p.verse_id
    ORDER BY p.created_at DESC LIMIT 50
  `).all();

  const withSocial = posts.map(p => {
    const likeCount = db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id = ?').get(p.id).c;
    const likedByMe = meId ? !!db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(p.id, meId) : false;
    const comments = db.prepare(`
      SELECT c.id, c.content, c.created_at, u.display_name author
      FROM post_comments c JOIN users u ON u.id = c.user_id
      WHERE c.post_id = ? ORDER BY c.created_at ASC
    `).all(p.id);
    let pace = null, distanceKm = p.distance_km ?? null;
    if (p.workout_type && p.start_time && p.end_time) {
      const mins = (new Date(p.end_time) - new Date(p.start_time)) / 60000;
      if (distanceKm == null) distanceKm = +(mins / 6).toFixed(1); // fallback estimate when no real GPS data
      pace = distanceKm > 0 ? (mins / distanceKm).toFixed(1) : null;
    }
    return { ...p, like_count: likeCount, liked_by_me: likedByMe, comments, distance_km: distanceKm, pace_min_per_km: pace };
  });
  res.json(withSocial);
});

router.post('/posts/:id/like', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT 1 FROM post_likes WHERE post_id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (existing) {
    db.prepare('DELETE FROM post_likes WHERE post_id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  } else {
    db.prepare('INSERT INTO post_likes (post_id, user_id) VALUES (?, ?)').run(req.params.id, req.session.userId);
  }
  const likeCount = db.prepare('SELECT COUNT(*) c FROM post_likes WHERE post_id = ?').get(req.params.id).c;
  res.json({ liked: !existing, like_count: likeCount });
});

router.post('/posts/:id/comments', requireAuth, (req, res) => {
  const { content } = req.body || {};
  if (!content || !content.trim()) return res.status(400).json({ error: 'empty_comment' });
  const id = randomUUID();
  db.prepare('INSERT INTO post_comments (id, post_id, user_id, content) VALUES (?, ?, ?, ?)').run(id, req.params.id, req.session.userId, content.trim());
  const comment = db.prepare(`SELECT c.id, c.content, c.created_at, u.display_name author FROM post_comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?`).get(id);
  res.json(comment);
});

// ---- workouts ----
router.post('/workouts/start', requireAuth, (req, res) => {
  const { type = 'Run' } = req.body || {};
  const id = randomUUID();
  db.prepare('INSERT INTO workouts (id, user_id, type, start_time) VALUES (?, ?, ?, ?)')
    .run(id, req.session.userId, type, new Date().toISOString());
  publish('workout.started', { user_id: req.session.userId, workout_id: id, type });
  res.json({ id, type, start_time: new Date().toISOString() });
});

router.post('/workouts/:id/sample', requireAuth, (req, res) => {
  const { heart_rate, stress_level } = req.body || {};
  const workout = db.prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!workout) return res.status(404).json({ error: 'not_found' });
  db.prepare('INSERT INTO biometric_samples (id, user_id, workout_id, time, heart_rate, stress_level) VALUES (?, ?, ?, ?, ?, ?)')
    .run(randomUUID(), req.session.userId, workout.id, new Date().toISOString(), heart_rate, stress_level ?? 0);

  // Run the real scripture trigger pipeline on this live biometric sample.
  const consents = db.prepare('SELECT scope FROM user_consents WHERE user_id = ? AND revoked_at IS NULL').all(req.session.userId).map(r => r.scope);
  const personalizationEnabled = consents.includes('scripture_personalization');
  const candidateVerses = db.prepare('SELECT id, reference, youversion_id, themes FROM scripture_verses').all()
    .map(v => ({ ...v, themes: v.themes.split(',') }));
  const history = db.prepare('SELECT verse_id FROM scripture_triggers WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20').all(req.session.userId);

  const result = runPipeline({
    rawSnapshot: { heart_rate, workout_type: workout.type, movement: { intensity: 0.8 }, stress_level: stress_level ?? 0 },
    candidateVerses,
    userHistory: history.map(h => ({ verse_id: h.verse_id, engaged: false })),
    userPreferences: {},
    personalizationEnabled,
    verseTextLookup: (yid) => db.prepare('SELECT text FROM scripture_verses WHERE youversion_id = ?').get(yid),
  });

  db.prepare('INSERT INTO scripture_triggers (id, user_id, verse_id, trigger_type, biometric_snapshot) VALUES (?, ?, ?, ?, ?)')
    .run(randomUUID(), req.session.userId, result.verse.id, result.context, JSON.stringify(result.snapshot));

  publish('verse.triggered', { user_id: req.session.userId, verse_id: result.verse.id, youversion_id: result.verse.youversion_id, trigger_type: result.context, payload: result.payload });

  res.json({ context: result.context, verse: result.payload });
});

router.post('/workouts/:id/stop', requireAuth, (req, res) => {
  const workout = db.prepare('SELECT * FROM workouts WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!workout) return res.status(404).json({ error: 'not_found' });
  const samples = db.prepare('SELECT * FROM biometric_samples WHERE workout_id = ?').all(workout.id);
  const hrs = samples.map(s => s.heart_rate).filter(Boolean);
  const avgHr = hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null;
  const maxHr = hrs.length ? Math.max(...hrs) : null;
  const { gps_distance_km, gps_points } = req.body || {};
  // Calories: use real GPS distance if we have one (running ~ 60 kcal/km), else fall back to a duration-based estimate.
  const durationMin = (Date.now() - new Date(workout.start_time).getTime()) / 60000;
  const calories = gps_distance_km > 0 ? Math.round(gps_distance_km * 60) : Math.round(durationMin * 8);

  db.prepare("UPDATE workouts SET end_time = datetime('now'), avg_hr = ?, max_hr = ?, calories = ?, distance_km = ?, gps_points = ? WHERE id = ?")
    .run(avgHr, maxHr, calories, gps_distance_km || null, gps_points || 0, workout.id);

  publish('workout.completed', { user_id: req.session.userId, workout_id: workout.id, calories, avg_hr: avgHr, max_hr: maxHr });

  res.json({ id: workout.id, calories, avg_hr: avgHr, max_hr: maxHr, distance_km: gps_distance_km || null });
});

router.post('/posts', requireAuth, (req, res) => {
  const { content, workout_id, verse_id } = req.body || {};
  const id = randomUUID();
  db.prepare('INSERT INTO posts (id, user_id, content, workout_id, verse_id) VALUES (?, ?, ?, ?, ?)')
    .run(id, req.session.userId, content, workout_id || null, verse_id || null);
  res.json({ id });
});

// ---- explore ----
router.get('/explore', (req, res) => {
  const groups = db.prepare('SELECT * FROM groups').all();
  const quests = db.prepare('SELECT * FROM quests').all();
  res.json({ groups, quests });
});

// ---- notifications ----
router.get('/notifications', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY delivered_at DESC LIMIT 20').all(req.session.userId));
});

// ---- gamification + notification event handlers (in-process, mirrors the Kafka consumers) ----
subscribe('workout.completed', (event) => {
  const xp = xpForEvent('workout.completed');
  const current = db.prepare('SELECT * FROM user_xp WHERE user_id = ?').get(event.user_id) || { xp: 0 };
  const newXp = current.xp + xp;
  const newLevel = levelForXp(newXp);
  db.prepare("INSERT INTO user_xp (user_id, xp, level, updated_at) VALUES (?, ?, ?, datetime('now')) ON CONFLICT(user_id) DO UPDATE SET xp=excluded.xp, level=excluded.level, updated_at=excluded.updated_at")
    .run(event.user_id, newXp, newLevel);

  const workoutCount = db.prepare("SELECT COUNT(*) c FROM workouts WHERE user_id = ? AND end_time IS NOT NULL").get(event.user_id).c;
  const verseCount = db.prepare('SELECT COUNT(*) c FROM scripture_triggers WHERE user_id = ?').get(event.user_id).c;
  const groupCount = db.prepare('SELECT COUNT(*) c FROM group_members WHERE user_id = ?').get(event.user_id).c;
  const earned = badgeEligibility({ workoutsCompleted: workoutCount, versesEngaged: verseCount, groupsJoined: groupCount });
  earned.forEach(badgeId => {
    const already = db.prepare('SELECT 1 FROM user_badges WHERE user_id = ? AND badge_id = ?').get(event.user_id, badgeId);
    if (!already) {
      db.prepare('INSERT INTO user_badges (user_id, badge_id) VALUES (?, ?)').run(event.user_id, badgeId);
      publish('badge.awarded', { user_id: event.user_id, badge_id: badgeId });
    }
  });

  // quest progress
  const quests = db.prepare('SELECT * FROM quests').all();
  quests.forEach(q => {
    const uq = db.prepare('SELECT * FROM user_quests WHERE user_id = ? AND quest_id = ?').get(event.user_id, q.id);
    if (!uq || uq.completed) return;
    const { progress, completed } = advanceQuestProgress(q, JSON.parse(uq.progress || '{}'), event);
    db.prepare('UPDATE user_quests SET progress = ?, completed = ? WHERE user_id = ? AND quest_id = ?')
      .run(JSON.stringify(progress), completed ? 1 : 0, event.user_id, q.id);
    if (completed) publish('quest.progress', { user_id: event.user_id, quest_id: q.id, progress, completed: true });
  });
});

['verse.triggered', 'badge.awarded', 'quest.progress'].forEach(topic => {
  subscribe(topic, (event) => {
    const message = composeForEvent(topic, event);
    db.prepare('INSERT INTO notifications (id, user_id, type, payload) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), event.user_id, message.type, JSON.stringify(message));
  });
});

// ---- motivation / podcasts / breathing (new social+wellness surfaces) ----
router.get('/motivation', (req, res) => {
  const rows = db.prepare('SELECT * FROM motivation_quotes').all();
  res.json(rows[Math.floor(Math.random() * rows.length)]);
});

router.get('/podcasts', (req, res) => {
  res.json(db.prepare('SELECT * FROM podcasts ORDER BY title').all());
});

router.post('/breathing/complete', requireAuth, (req, res) => {
  const { pattern = 'box', duration_sec = 60 } = req.body || {};
  db.prepare('INSERT INTO breathing_sessions (id, user_id, pattern, duration_sec) VALUES (?, ?, ?, ?)')
    .run(randomUUID(), req.session.userId, pattern, duration_sec);
  publish('workout.completed', { user_id: req.session.userId, workout_id: null, calories: 0, avg_hr: null, max_hr: null, kind: 'breathing' });
  res.json({ ok: true });
});


// ---- Secure profile: bio is restricted to a real Bible verse only. ----
// Allowed free-text fields are limited to job, church, fitness_group, gym.
// Age is optional and hidden by default (show_age).
const ALLOWED_PROFILE_FIELDS = ['job', 'church', 'fitness_group', 'gym'];
const MAX_FIELD_LEN = 80;

router.put('/profile', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const { display_name, bio_verse_ref, job, church, fitness_group, gym, age, show_age } = req.body || {};

  const updates = {};

  if (display_name !== undefined) {
    const name = String(display_name).trim().slice(0, 60);
    if (!name) return res.status(400).json({ error: 'invalid_display_name' });
    updates.display_name = name;
  }

  // Bio must match a verse actually present in our verified bible_verses table —
  // never freeform text, and never fabricated/unverified scripture.
  if (bio_verse_ref !== undefined) {
    if (bio_verse_ref === null || bio_verse_ref === '') {
      updates.bio_verse_ref = null;
      updates.bio_verse_text = null;
    } else {
      const ref = String(bio_verse_ref).trim();
      const m = ref.match(/^(.+?)\s+(\d+):(\d+)$/);
      if (!m) return res.status(400).json({ error: 'invalid_verse_format', hint: 'Use "Book Chapter:Verse", e.g. "Philippians 4:13"' });
      const [, book, chapter, verse] = m;
      const row = db.prepare('SELECT text, book, chapter, verse, translation FROM bible_verses WHERE book = ? AND chapter = ? AND verse = ?')
        .get(book.trim(), Number(chapter), Number(verse));
      if (!row) return res.status(400).json({ error: 'verse_not_found', hint: 'That verse is not yet in our verified library. Try another reference.' });
      updates.bio_verse_ref = `${row.book} ${row.chapter}:${row.verse}`;
      updates.bio_verse_text = row.text;
    }
  }

  for (const field of ALLOWED_PROFILE_FIELDS) {
    const val = req.body ? req.body[field] : undefined;
    if (val !== undefined) {
      updates[field] = val === null ? null : String(val).trim().slice(0, MAX_FIELD_LEN);
    }
  }

  if (age !== undefined) {
    if (age === null || age === '') {
      updates.age = null;
    } else {
      const n = Number(age);
      if (!Number.isInteger(n) || n < 13 || n > 120) return res.status(400).json({ error: 'invalid_age' });
      updates.age = n;
    }
  }

  if (show_age !== undefined) updates.show_age = show_age ? 1 : 0;

  const keys = Object.keys(updates);
  if (!keys.length) return res.status(400).json({ error: 'no_fields' });

  const setClause = keys.map(k => `${k} = @${k}`).join(', ');
  db.prepare(`UPDATE users SET ${setClause} WHERE id = @id`).run({ ...updates, id: uid });

  const { password_hash, email, ...safeUser } = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  res.json({ ok: true, user: safeUser });
});

// ---- Bible: real, public-domain (KJV/WEB) text, FTS5-backed fast search. ----
// Coverage is a verified public-domain subset, expanding over time. See the live
// /api/bible/coverage endpoint for the exact books/chapters currently loaded —
// never hardcode a coverage claim here, it drifts. Ingestion: scripts/ingest-bible.js.
router.get('/bible/passage/:book/:chapter', (req, res) => {
  const { book, chapter } = req.params;
  const rows = db.prepare('SELECT book, chapter, verse, text, translation FROM bible_verses WHERE book = ? AND chapter = ? ORDER BY verse')
    .all(book, Number(chapter));
  if (!rows.length) return res.status(404).json({ error: 'not_found', hint: 'This chapter is not yet in our verified library.' });
  res.json({ book, chapter: Number(chapter), translation: rows[0].translation, verses: rows });
});

router.get('/bible/search', (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'missing_query' });
  // Prefix-match each word so partial terms like "streng" still find "strengtheneth".
  const ftsQuery = q.replace(/["*]/g, '').trim().split(/\s+/).map(w => `${w}*`).join(' ');

  // Pagination — result volume grows with coverage, so cap per-page and expose total.
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
  const page = Math.max(1, Number(req.query.page) || 1);
  const offset = (page - 1) * limit;

  const total = db.prepare(`
    SELECT COUNT(*) c FROM bible_verses_fts WHERE bible_verses_fts MATCH ?
  `).get(ftsQuery).c;

  const rows = db.prepare(`
    SELECT bv.book, bv.chapter, bv.verse, bv.text, bv.translation
    FROM bible_verses_fts f
    JOIN bible_verses bv ON bv.rowid = f.rowid
    WHERE bible_verses_fts MATCH ?
    ORDER BY rank
    LIMIT ? OFFSET ?
  `).all(ftsQuery, limit, offset);

  res.json({ query: q, page, limit, total, count: rows.length, results: rows });
});

router.get('/bible/random', (req, res) => {
  const row = db.prepare('SELECT book, chapter, verse, text, translation FROM bible_verses ORDER BY RANDOM() LIMIT 1').get();
  if (!row) return res.status(404).json({ error: 'no_verses_loaded' });
  res.json(row);
});

router.get('/bible/coverage', (req, res) => {
  const rows = db.prepare('SELECT book, translation, MIN(chapter) min_ch, MAX(chapter) max_ch, COUNT(DISTINCT chapter) chapters, COUNT(*) verse_count FROM bible_verses GROUP BY book, translation ORDER BY book').all();
  const total = db.prepare('SELECT COUNT(*) c FROM bible_verses').get().c;
  res.json({ note: 'Verified public-domain subset (KJV/WEB via bible-api.com), not the full canon.', total_verses: total, books: rows.length, coverage: rows });
});

module.exports = router;
