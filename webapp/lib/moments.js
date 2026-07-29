/**
 * The right word at the right physiological moment.
 *
 * Classifies where someone actually is inside a session — just starting, on a
 * climb, against the wall, holding steady, cooling down, or finishing — and
 * picks scripture that meets that moment rather than broadcasting a verse of
 * the day into it.
 *
 * Two rules govern this file:
 *
 *  1. No invented physiology. A moment that depends on heart rate is only ever
 *     returned when a real monitor is streaming. With no strap connected we
 *     classify from time, distance, speed and the route's own gradient, and we
 *     say so — we never infer a zone from pace and present it as measured.
 *
 *  2. No invented scripture. This module stores references only. The verse text
 *     is resolved from the ingested public-domain text at call time, and a
 *     reference that does not resolve is dropped rather than guessed at.
 */
'use strict';

const { hrZone } = require('./effort');

// Moments, in the order they are checked. Earlier entries win a tie.
const MOMENTS = {
  finishing: {
    label: 'Finishing',
    blurb: 'The end of the road is in sight.',
    refs: ['2 Timothy 4:7', 'Hebrews 12:1', '1 Corinthians 9:24', 'Philippians 3:14', 'Psalm 18:33'],
  },
  wall: {
    label: 'Against the wall',
    blurb: 'The hardest part of the session.',
    refs: ['Isaiah 40:29', 'Isaiah 41:10', 'Psalm 73:26', 'Matthew 11:28', 'Psalm 34:18', 'Isaiah 40:31'],
  },
  climbing: {
    label: 'Climbing',
    blurb: 'The road is going up.',
    refs: ['Psalm 121:1', 'Psalm 18:32', 'Psalm 61:2', 'Isaiah 40:31', 'Psalm 24:3'],
  },
  cooling: {
    label: 'Cooling down',
    blurb: 'Coming back down after the work.',
    refs: ['Psalm 23:2', 'Mark 6:31', 'Psalm 46:10', 'Matthew 11:29', 'Psalm 4:8'],
  },
  starting: {
    label: 'Starting out',
    blurb: 'The first few minutes.',
    refs: ['Hebrews 12:1', 'Proverbs 4:26', 'Psalm 121:8', 'Philippians 3:14', 'Isaiah 40:31'],
  },
  steady: {
    label: 'Steady state',
    blurb: 'Settled into the work.',
    refs: ['1 Corinthians 9:24', 'Psalm 16:8', 'Proverbs 3:6', 'Psalm 23:3', 'Philippians 4:13'],
  },
};

/**
 * Classify the current moment.
 *
 * @param {object} t telemetry
 *   elapsed_sec     seconds since the session started
 *   distance_km     covered so far
 *   total_km        route length (optional)
 *   speed_kmh       current speed (may be null)
 *   recent_speeds   recent speed samples, oldest first (optional)
 *   hr              current heart rate, ONLY from a real monitor (else null)
 *   recent_hr       recent HR samples, oldest first (optional)
 *   max_hr          the user's max HR for zone maths (optional)
 *   terrain         route terrain, e.g. 'climb'
 * @returns {{moment:string,label:string,blurb:string,measured:boolean,reason:string,zone:number|null}}
 */
function classify(t) {
  const el = Number(t.elapsed_sec) || 0;
  const dist = Number(t.distance_km) || 0;
  const total = Number(t.total_km) || 0;
  const hr = Number.isFinite(Number(t.hr)) && Number(t.hr) > 0 ? Number(t.hr) : null;
  const maxHr = Number(t.max_hr) || null;
  const zone = (hr && maxHr) ? hrZone(hr, maxHr) : null;

  // Averages over whatever history we were given.
  const avg = (arr) => {
    const nums = (arr || []).map(Number).filter(n => Number.isFinite(n) && n > 0);
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
  };
  const avgSpeed = avg(t.recent_speeds);
  const speed = Number.isFinite(Number(t.speed_kmh)) ? Number(t.speed_kmh) : null;

  const measured = hr !== null;
  const out = (moment, reason) => ({
    moment,
    label: MOMENTS[moment].label,
    blurb: MOMENTS[moment].blurb,
    measured,
    reason,
    zone,
  });

  // Finishing — the last stretch of a route with a known length.
  if (total > 0 && dist >= total * 0.9 && dist < total) {
    return out('finishing', 'Inside the last 10% of the route.');
  }

  // The session watches the road and the rider directly, so when it says a
  // climb is coming or the pace has been fading, that beats anything re-derived
  // here from numbers that have already moved on.
  if (t.trigger === 'climb_ahead') {
    const g = Number(t.grade_ahead);
    return out('climbing', Number.isFinite(g) && g >= 1
      ? 'A climb ahead, around ' + g.toFixed(1) + '%.'
      : 'A climb is coming up.');
  }
  if (t.trigger === 'slowing') {
    return out('wall', 'Your pace has been off your average for a while.');
  }

  // Cooling down — effort has clearly dropped off after real work was done.
  // Requires history; a momentary dip is not a cool-down.
  if (el > 600) {
    if (zone !== null && zone <= 1 && avg(t.recent_hr) !== null && avg(t.recent_hr) < (maxHr * 0.6)) {
      return out('cooling', 'Heart rate has come back down into zone 1.');
    }
    if (!measured && speed !== null && avgSpeed !== null && avgSpeed > 0 && speed < avgSpeed * 0.55) {
      return out('cooling', 'Pace has dropped well below your session average.');
    }
  }

  // Against the wall — sustained hard effort, or effort decaying under load.
  // This is the one moment that most wants a measured signal, so without a
  // monitor we only claim it well into a long session with a real pace fade.
  if (zone !== null && zone >= 4 && el > 420) {
    return out('wall', 'Zone ' + zone + ' held past seven minutes in.');
  }
  if (!measured && el > 1500 && speed !== null && avgSpeed !== null && avgSpeed > 0
      && speed < avgSpeed * 0.78) {
    return out('wall', 'Pace fading deep into a long session.');
  }

  // Climbing — the route itself is going up. This is route metadata, not
  // inferred physiology, so it is honest with or without a strap.
  if (t.terrain === 'climb' && el > 120) {
    return out('climbing', 'This route is a sustained climb.');
  }

  // Starting out.
  if (el <= 300) return out('starting', 'First five minutes of the session.');

  return out('steady', measured
    ? (zone ? 'Settled in zone ' + zone + '.' : 'Settled into a rhythm.')
    : 'Settled into a rhythm.');
}

/**
 * Pick a reference for a moment, avoiding anything already shown this session.
 * Returns null when every reference for the moment has been used.
 */
function pickRef(moment, seenRefs) {
  const m = MOMENTS[moment];
  if (!m) return null;
  const seen = new Set(seenRefs || []);
  const fresh = m.refs.filter(r => !seen.has(r));
  const pool = fresh.length ? fresh : [];
  if (!pool.length) return null;
  // Deterministic rotation rather than random: the order is authored, so the
  // strongest verse for a moment is the one you get first.
  return pool[0];
}

module.exports = { classify, pickRef, MOMENTS };
