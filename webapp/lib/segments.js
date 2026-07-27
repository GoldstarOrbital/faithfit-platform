/**
 * Segments, personal bests, leaderboards and ghosts.
 *
 * The part of a Zwift-style ride that makes it a game rather than a treadmill
 * with scenery: the stretch between two waypoints is a timed segment, your time
 * on it is kept, and you can see it against your own best and against everyone
 * else who has ridden the same road.
 *
 * Ghosts are built from stored segment times, not from invented pacing. A ghost
 * only exists where somebody actually rode, and it moves at the average speed
 * they actually held across that segment. Where there is no recorded ride there
 * is no ghost — we never populate a route with fictional company.
 */
'use strict';

const { randomUUID } = require('crypto');
const db = require('./db');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS journey_segment_times (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      journey_id TEXT NOT NULL,
      segment_index INTEGER NOT NULL,   -- 0 = start to first waypoint
      from_km REAL NOT NULL,
      to_km REAL NOT NULL,
      duration_sec REAL NOT NULL,
      measured INTEGER NOT NULL DEFAULT 0,  -- 1 when speed came from equipment/GPS
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_segtimes_board
      ON journey_segment_times(journey_id, segment_index, duration_sec);
    CREATE INDEX IF NOT EXISTS idx_segtimes_user
      ON journey_segment_times(user_id, journey_id);
  `);
}

/** The segment boundaries of a route: waypoint km marks, plus the finish. */
function segmentsFor(journeyId, totalKm) {
  const marks = db.prepare('SELECT km_mark, title FROM journey_waypoints WHERE journey_id = ? ORDER BY km_mark')
    .all(journeyId).map(w => ({ km: Number(w.km_mark), title: w.title }));
  const out = [];
  for (let i = 0; i < marks.length; i++) {
    const from = marks[i];
    const to = marks[i + 1] || { km: Number(totalKm), title: 'The finish' };
    if (to.km > from.km) out.push({ index: i, from_km: from.km, to_km: to.km, from: from.title, to: to.title });
  }
  return out;
}

/**
 * Record a completed segment. Returns the standing achieved, so the client can
 * say something true about it ("personal best", "2nd on this road").
 */
function recordSegment(userId, journeyId, seg, durationSec, measured) {
  const dur = Number(durationSec);
  if (!Number.isFinite(dur) || dur <= 0) return null;
  // A segment covered impossibly fast is a bug or a bad sensor frame, not a
  // record. 90 km/h over the segment is well past any human on any equipment.
  const km = Number(seg.to_km) - Number(seg.from_km);
  if (km <= 0 || (km / (dur / 3600)) > 90) return null;

  const prevBest = db.prepare(`SELECT MIN(duration_sec) AS best FROM journey_segment_times
                               WHERE user_id = ? AND journey_id = ? AND segment_index = ?`)
    .get(userId, journeyId, seg.index).best;

  db.prepare(`INSERT INTO journey_segment_times
              (id, user_id, journey_id, segment_index, from_km, to_km, duration_sec, measured)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(randomUUID(), userId, journeyId, seg.index, seg.from_km, seg.to_km, dur, measured ? 1 : 0);

  // Rank among each rider's own best, so one person riding a road ten times
  // cannot fill the leaderboard.
  const better = db.prepare(`SELECT COUNT(*) AS c FROM (
                               SELECT user_id, MIN(duration_sec) AS best
                               FROM journey_segment_times
                               WHERE journey_id = ? AND segment_index = ?
                               GROUP BY user_id
                             ) WHERE best < ?`)
    .get(journeyId, seg.index, dur).c;

  return {
    segment_index: seg.index,
    duration_sec: Math.round(dur),
    personal_best: prevBest == null || dur < prevBest,
    previous_best_sec: prevBest == null ? null : Math.round(prevBest),
    rank: better + 1,
    measured: !!measured,
  };
}

/** Leaderboard for one segment: each rider's best, fastest first. */
function leaderboard(journeyId, segmentIndex, limit = 10) {
  return db.prepare(`SELECT u.id AS user_id, u.display_name, u.avatar_data,
                            MIN(t.duration_sec) AS best_sec,
                            MAX(t.measured) AS measured
                     FROM journey_segment_times t
                     JOIN users u ON u.id = t.user_id
                     WHERE t.journey_id = ? AND t.segment_index = ?
                     GROUP BY u.id
                     ORDER BY best_sec ASC
                     LIMIT ?`)
    .all(journeyId, segmentIndex, limit)
    .map((r, i) => ({
      position: i + 1,
      user_id: r.user_id,
      display_name: r.display_name,
      avatar_data: r.avatar_data || null,
      best_sec: Math.round(r.best_sec),
      measured: !!r.measured,
    }));
}

/**
 * Ghosts for a route: for each rider who has ridden it, their best pace on each
 * segment. The client advances them in step with the live session so you can
 * see whether you are up or down on them.
 *
 * Returns only real recorded rides. An empty list means nobody has ridden this
 * road yet, and the client says exactly that rather than inventing company.
 */
function ghostsFor(journeyId, opts = {}) {
  const exclude = opts.excludeUserId || '';
  const limit = Math.min(Number(opts.limit) || 5, 10);

  const riders = db.prepare(`SELECT t.user_id, u.display_name,
                                    SUM(t.best_sec) AS total_sec
                             FROM (
                               SELECT user_id, segment_index, MIN(duration_sec) AS best_sec
                               FROM journey_segment_times
                               WHERE journey_id = ?
                               GROUP BY user_id, segment_index
                             ) t
                             JOIN users u ON u.id = t.user_id
                             WHERE t.user_id != ?
                             GROUP BY t.user_id
                             ORDER BY total_sec ASC
                             LIMIT ?`)
    .all(journeyId, exclude, limit);

  const segStmt = db.prepare(`SELECT segment_index, from_km, to_km, MIN(duration_sec) AS best_sec
                              FROM journey_segment_times
                              WHERE journey_id = ? AND user_id = ?
                              GROUP BY segment_index
                              ORDER BY segment_index`);

  return riders.map(r => ({
    user_id: r.user_id,
    display_name: r.display_name,
    total_sec: Math.round(r.total_sec),
    // km-per-second on each segment: enough to place a ghost at any elapsed
    // time without storing a full position trace.
    segments: segStmt.all(journeyId, r.user_id).map(s => ({
      index: s.segment_index,
      from_km: s.from_km,
      to_km: s.to_km,
      duration_sec: Math.round(s.best_sec),
    })),
  }));
}

/** Your own best on each segment of a route, for the ghost of your past self. */
function personalGhost(userId, journeyId) {
  const segs = db.prepare(`SELECT segment_index, from_km, to_km, MIN(duration_sec) AS best_sec
                           FROM journey_segment_times
                           WHERE journey_id = ? AND user_id = ?
                           GROUP BY segment_index ORDER BY segment_index`)
    .all(journeyId, userId);
  if (!segs.length) return null;
  return {
    user_id: userId,
    display_name: 'Your best',
    is_self: true,
    total_sec: Math.round(segs.reduce((a, s) => a + s.best_sec, 0)),
    segments: segs.map(s => ({
      index: s.segment_index, from_km: s.from_km, to_km: s.to_km,
      duration_sec: Math.round(s.best_sec),
    })),
  };
}

module.exports = { init, segmentsFor, recordSegment, leaderboard, ghostsFor, personalGhost };
