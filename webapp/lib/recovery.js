/**
 * Recovery and training load.
 *
 * Two real, independent signals, combined honestly rather than blended into
 * one fake "recovery score":
 *
 *   1. Training load (ACWR) -- the acute:chronic workload ratio, a published
 *      sports-science metric (Gabbett et al.), not something invented for
 *      this file. Acute = average daily load over the last 7 days. Chronic =
 *      average daily load over the last 28 days. Load per session is
 *      duration_min * avg_hr when heart rate was recorded (a session-RPE-lite
 *      proxy), or just duration_min when it wasn't -- degrading the PRECISION
 *      of the number, never fabricating a heart rate that was not measured.
 *      This works for every member: it needs nothing but workouts they
 *      already logged.
 *
 *   2. Wearable readiness -- sleep_score / readiness_score / hrv, already
 *      pulled from Oura and Fitbit by lib/wearables.js and stored in
 *      wearable_metrics on every sync. That data has existed since the
 *      wearables integration shipped and was never read back out anywhere
 *      until now.
 *
 * Recovery features are available to every Functioning Faith member and (for
 * "Training Load") require a connected wearable to mean anything at all,
 * ACWR here works from workout history alone, for free, for everyone -- the
 * wearable panel is additive when connected, not a precondition to seeing
 * anything.
 *
 * No number here is a medical claim. The copy says what the ratio is and
 * what the literature associates with each band, not "your body is X."
 */
'use strict';

const db = require('./db');

const DAY_MS = 86400000;

function daysAgo(n) {
  return new Date(Date.now() - n * DAY_MS).toISOString();
}

/** Load for one workout: duration_min * avg_hr if HR exists, else duration_min alone. */
function sessionLoad(w) {
  if (!w.start_time || !w.end_time) return 0;
  const durMin = (new Date(w.end_time) - new Date(w.start_time)) / 60000;
  if (!Number.isFinite(durMin) || durMin <= 0) return 0;
  return w.avg_hr ? durMin * w.avg_hr : durMin * 60; // 60 stands in for "moderate effort" HR when unmeasured
}

/**
 * ACWR and a plain-language band. `undertrained` and `spike-risk` follow the
 * ranges most commonly cited in the sports-science literature; anything
 * outside them is `sustainable`. Returns null (not a guess) when there is
 * not enough history to compute a chronic average -- an ACWR from four days
 * of data is not a real ratio.
 */
function trainingLoad(userId, now = new Date()) {
  const rows = db.prepare(
    `SELECT start_time, end_time, avg_hr FROM workouts
     WHERE user_id = ? AND end_time IS NOT NULL AND end_time > ?`
  ).all(userId, daysAgo(28));

  if (!rows.length) return { available: false, reason: 'no_workouts' };

  const nowMs = now.getTime();
  let acuteSum = 0, chronicSum = 0, acuteDays = new Set(), chronicDays = new Set();
  for (const w of rows) {
    const ageDays = (nowMs - new Date(w.end_time).getTime()) / DAY_MS;
    const load = sessionLoad(w);
    if (ageDays <= 28) { chronicSum += load; chronicDays.add(Math.floor(ageDays)); }
    if (ageDays <= 7) { acuteSum += load; acuteDays.add(Math.floor(ageDays)); }
  }

  // Need real spread, not two workouts on the same day masquerading as a trend.
  if (chronicDays.size < 10) return { available: false, reason: 'not_enough_history' };

  const acuteAvg = acuteSum / 7;
  const chronicAvg = chronicSum / 28;
  if (chronicAvg <= 0) return { available: false, reason: 'not_enough_history' };

  const ratio = +(acuteAvg / chronicAvg).toFixed(2);
  let band, headline;
  if (ratio < 0.8) { band = 'undertrained'; headline = 'Lighter than your last month'; }
  else if (ratio > 1.5) { band = 'spike-risk'; headline = 'A sharp jump from your last month'; }
  else { band = 'sustainable'; headline = 'In line with your last month'; }

  return {
    available: true,
    ratio,
    band,
    headline,
    acute_7d_sessions: rows.filter(w => (nowMs - new Date(w.end_time).getTime()) / DAY_MS <= 7).length,
  };
}

/** Most recent wearable reading within the last 3 days -- older than that is not "today's" readiness. */
function latestReadiness(userId) {
  const row = db.prepare(
    `SELECT provider, metric_date, sleep_score, sleep_sec, readiness_score, hrv
     FROM wearable_metrics WHERE user_id = ? AND metric_date >= ? ORDER BY metric_date DESC LIMIT 1`
  ).get(userId, daysAgo(3).slice(0, 10));
  if (!row) return { available: false };
  return {
    available: true,
    provider: row.provider,
    date: row.metric_date,
    sleep_score: row.sleep_score,
    sleep_hours: row.sleep_sec ? +(row.sleep_sec / 3600).toFixed(1) : null,
    readiness_score: row.readiness_score,
    hrv: row.hrv,
  };
}

function summary(userId) {
  return {
    training_load: trainingLoad(userId),
    wearable: latestReadiness(userId),
  };
}

module.exports = { summary, trainingLoad, latestReadiness };
