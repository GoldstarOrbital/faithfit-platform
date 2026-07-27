/**
 * Effort measurement — heart-rate zones, time-in-zone, and a TRIMP-style effort score.
 *
 * Design rule for this module: it NEVER invents physiology. If we don't know the
 * user's max heart rate, every zone-derived value comes back `null` and the UI is
 * expected to say so plainly ("zone insights need a paired heart-rate monitor")
 * rather than showing a fabricated number.
 *
 * Pure functions only — no DB, no I/O — so the callers stay testable.
 */

/**
 * Best available max-HR figure for a user.
 *
 * Priority:
 *   1. `users.max_hr` — a value the user measured or entered themselves. Treated as
 *      ground truth, and reported as `source: 'user'`.
 *   2. Tanaka formula: HRmax = 208 - 0.7 x age, derived from `users.birth_year`.
 *      Source: Tanaka H, Monahan KD, Seals DR, "Age-predicted maximal heart rate
 *      revisited", J Am Coll Cardiol 2001;37(1):153-6. It is better validated across
 *      age groups than the folk "220 - age" rule, which systematically underestimates
 *      max HR in older adults. Reported as `source: 'estimate'`.
 *   3. Unknown -> null.
 *
 * Callers MUST propagate `source` to the UI: an estimate is never to be presented as
 * a measurement.
 *
 * @returns {{ value: number, source: 'user'|'estimate', formula?: string }|null}
 */
function maxHrInfo(user, now = new Date()) {
  if (!user) return null;
  const stated = Number(user.max_hr);
  if (Number.isFinite(stated) && stated >= 120 && stated <= 230) {
    return { value: Math.round(stated), source: 'user' };
  }
  const birthYear = Number(user.birth_year);
  if (Number.isInteger(birthYear) && birthYear >= 1900 && birthYear <= now.getFullYear() - 10) {
    const age = now.getFullYear() - birthYear;
    return {
      value: Math.round(208 - 0.7 * age),
      source: 'estimate',
      formula: 'Tanaka (208 - 0.7 x age)',
    };
  }
  return null;
}

/** Convenience wrapper: just the number (or null). See maxHrInfo for provenance. */
function estimatedMaxHr(user, now = new Date()) {
  const info = maxHrInfo(user, now);
  return info ? info.value : null;
}

/**
 * Standard %HRmax zone bands.
 *   Z1 <60%  recovery
 *   Z2 60-70% aerobic base
 *   Z3 70-80% tempo
 *   Z4 80-90% threshold
 *   Z5 >=90%  maximal
 * Returns null when maxHr is unknown — we do not guess a zone.
 */
function hrZone(hr, maxHr) {
  const h = Number(hr), m = Number(maxHr);
  if (!Number.isFinite(h) || h <= 0) return null;
  if (!Number.isFinite(m) || m <= 0) return null;
  const pct = h / m;
  if (pct < 0.60) return 1;
  if (pct < 0.70) return 2;
  if (pct < 0.80) return 3;
  if (pct < 0.90) return 4;
  return 5;
}

const ZONE_LABELS = {
  1: 'Zone 1 · recovery',
  2: 'Zone 2 · base',
  3: 'Zone 3 · tempo',
  4: 'Zone 4 · threshold',
  5: 'Zone 5 · max',
};

/**
 * TRIMP-style zone weights (effort points per MINUTE spent in each zone).
 *
 * Banister's original TRIMP weights training load by an exponential function of
 * heart-rate reserve, so a minute at threshold costs far more than a minute jogging.
 * We use the same shape with a small, readable integer-ish ladder instead of the
 * exponential, because the number is shown to a human:
 *
 *   Z1 1.0 | Z2 2.0 | Z3 3.0 | Z4 4.5 | Z5 6.0
 *
 * The jump above Z3 (3 -> 4.5 -> 6) is what makes it TRIMP-like rather than a flat
 * time total: hard minutes are worth roughly double easy ones, and maximal minutes
 * six times a recovery minute. "Effort points" therefore reads as: a 30-minute easy
 * zone-2 session = 60 points; 30 minutes at threshold = 135 points.
 */
const ZONE_WEIGHTS = { 1: 1.0, 2: 2.0, 3: 3.0, 4: 4.5, 5: 6.0 };

/**
 * Turn a series of biometric samples into an effort summary.
 *
 * Each sample holds the zone until the next sample arrives (the live tracker posts
 * every ~5s), so a sample's dwell time is the gap to the following sample; the final
 * sample is held for the median gap, capped by any remaining session time. If sample
 * timestamps are unusable we fall back to distributing durationSec evenly.
 *
 * @param {Array<{time?: string, heart_rate?: number}>} samples
 * @param {number|null} maxHr
 * @param {number} durationSec
 * @returns {{time_in_zone: object|null, peak_zone: number|null, effort_score: number|null,
 *            avg_hr: number|null, max_hr_seen: number|null, hr_sample_count: number,
 *            zone_data: boolean, total_zoned_sec: number}}
 */
function summariseEffort(samples, maxHr, durationSec) {
  const list = (samples || [])
    .filter(s => Number.isFinite(Number(s.heart_rate)) && Number(s.heart_rate) > 0)
    .map(s => ({ t: s.time ? Date.parse(s.time) : NaN, hr: Number(s.heart_rate) }))
    .sort((a, b) => (Number.isFinite(a.t) && Number.isFinite(b.t) ? a.t - b.t : 0));

  const empty = {
    time_in_zone: null, peak_zone: null, effort_score: null,
    avg_hr: null, max_hr_seen: null, hr_sample_count: 0,
    zone_data: false, total_zoned_sec: 0,
  };
  if (!list.length) return empty;

  const avg_hr = Math.round(list.reduce((a, s) => a + s.hr, 0) / list.length);
  const max_hr_seen = Math.max(...list.map(s => s.hr));

  if (!Number.isFinite(Number(maxHr)) || Number(maxHr) <= 0) {
    // Honest degradation: we have heart rates but no reference max, so no zones.
    return { ...empty, avg_hr, max_hr_seen, hr_sample_count: list.length };
  }

  // Per-sample dwell.
  const gaps = [];
  for (let i = 1; i < list.length; i++) {
    const g = (list[i].t - list[i - 1].t) / 1000;
    if (Number.isFinite(g) && g > 0 && g <= 300) gaps.push(g);
  }
  const sorted = gaps.slice().sort((a, b) => a - b);
  const medianGap = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const evenGap = durationSec > 0 ? durationSec / list.length : 5;

  const time_in_zone = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (let i = 0; i < list.length; i++) {
    let hold;
    if (i < list.length - 1) {
      const g = (list[i + 1].t - list[i].t) / 1000;
      hold = Number.isFinite(g) && g > 0 && g <= 300 ? g : (medianGap || evenGap);
    } else {
      hold = medianGap || evenGap;
    }
    const z = hrZone(list[i].hr, maxHr);
    if (z) time_in_zone[z] += hold;
  }
  for (const k of Object.keys(time_in_zone)) time_in_zone[k] = Math.round(time_in_zone[k]);

  const total_zoned_sec = Object.values(time_in_zone).reduce((a, b) => a + b, 0);
  const peak_zone = [5, 4, 3, 2, 1].find(z => time_in_zone[z] > 0) || null;
  const effort_score = +Object.entries(time_in_zone)
    .reduce((a, [z, sec]) => a + (sec / 60) * ZONE_WEIGHTS[z], 0)
    .toFixed(1);

  return {
    time_in_zone, peak_zone, effort_score,
    avg_hr, max_hr_seen, hr_sample_count: list.length,
    zone_data: true, total_zoned_sec,
  };
}

function mins(sec) { return Math.round(sec / 60); }

/**
 * A specific, EARNED encouragement line for this session.
 *
 * Every branch cites a real number from this session, and every comparison is against
 * `personalBests` which the caller computes from the user's actual workout history.
 * When nothing genuinely notable happened, this returns null — the product does not
 * manufacture praise.
 *
 * @param {object} summary result of summariseEffort
 * @param {object} personalBests { bestZone45Sec, everZone5, bestEffortScore, priorSessionsWithZones }
 */
function describeEffort(summary, personalBests = {}) {
  const found = notableEffort(summary, personalBests);
  if (found) return found.message;
  if (!summary || !summary.zone_data) return null;

  const tiz = summary.time_in_zone;
  const total = summary.total_zoned_sec;
  if (!total || total < 600) return null; // under 10 minutes of data: nothing worth claiming

  // Steady aerobic work is real work — say so, but only when it actually dominated.
  for (const z of [2, 3]) {
    if (tiz[z] / total >= 0.7) {
      return z === 2
        ? `Steady zone 2 for ${mins(tiz[2])} of ${mins(total)} minutes. That's the work that builds a base.`
        : `You sat in zone 3 for ${mins(tiz[3])} minutes — controlled, sustained tempo.`;
    }
  }
  return null;
}

/**
 * Is this session notable enough to push a notification about? Returns null unless a
 * comparison against real history says yes.
 */
function notableEffort(summary, pb = {}) {
  if (!summary || !summary.zone_data || !summary.peak_zone) return null;
  const tiz = summary.time_in_zone;
  const hard = (tiz[4] || 0) + (tiz[5] || 0);

  if (tiz[5] > 0 && pb.everZone5 === false) {
    return {
      type: 'first_zone5',
      message: `First time into zone 5 — you touched ${summary.max_hr_seen} bpm today.`,
    };
  }
  if (hard >= 300 && Number.isFinite(pb.bestZone45Sec) && hard > pb.bestZone45Sec) {
    return {
      type: 'longest_hard_effort',
      message: `You held zone 4+ for ${mins(hard)} minutes — your longest hard effort in the last 30 days.`,
    };
  }
  if (Number.isFinite(pb.bestEffortScore) && (pb.priorSessionsWithZones || 0) >= 2 && summary.effort_score > pb.bestEffortScore) {
    return {
      type: 'best_effort_score',
      message: `${summary.effort_score} effort points — your highest-effort session yet.`,
    };
  }
  return null;
}

module.exports = {
  maxHrInfo, estimatedMaxHr, hrZone, summariseEffort,
  describeEffort, notableEffort,
  ZONE_WEIGHTS, ZONE_LABELS,
};
