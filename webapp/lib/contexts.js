/**
 * Moments that are not workouts.
 *
 * `lib/moments.js` classifies where someone is inside a session. This does the
 * same job for the rest of life: sitting down to breathe, and — the harder
 * one — a heart rate that has climbed while the body is still.
 *
 * The same two rules from moments.js apply here, and one more that matters more
 * here than anywhere else in the app:
 *
 *  1. No invented physiology. An elevated-at-rest reading is only ever returned
 *     when a real monitor is streaming AND a real resting baseline exists to
 *     compare it against. Without both we return `unknown` and say what is
 *     missing. A baseline is never estimated from age or guessed from a single
 *     session — "elevated" is a comparison, and a comparison to a number we
 *     made up is worthless.
 *
 *  2. No invented scripture. References only; text is resolved at call time.
 *
 *  3. NO INVENTED INTERIOR STATE. This is the one that governs the whole file.
 *     A heart rate is a measurement. Stress, anxiety, fear and dread are not —
 *     they are interpretations of a measurement, and a wrong one lands on
 *     someone at the worst possible moment. So nothing here ever tells a member
 *     what they are feeling. It reports what was measured ("18 bpm above your
 *     resting rate, and you have been still"), offers scripture, and offers a
 *     way to breathe. What that reading means is theirs to say, not ours.
 *
 *     This is also why the elevated contexts carry no reassurance in their
 *     blurb. Someone whose heart is climbing because they are about to be
 *     laid off is not helped by an app that has decided they are merely tense.
 */
'use strict';

// How far above resting, as a fraction of heart-rate reserve (max - resting),
// a still body has to sit before we will call it elevated.
//
// Karvonen reserve rather than raw bpm: +20 bpm is a lot for someone with a
// resting rate of 48 and unremarkable for someone at 78. The high threshold is
// deliberately well clear of the low one so a reading has to move a long way
// before the language changes.
const ELEVATED_FRACTION = 0.20;
const HIGH_FRACTION = 0.35;
const SETTLED_FRACTION = 0.10;

// A reading has to persist. Standing up, a cough, or a laugh will push a heart
// rate over any threshold for a few seconds, and an app that responds to that
// is an app people stop wearing.
const MIN_SAMPLES = 3;

const CONTEXTS = {
  // --- elevated while still -------------------------------------------------
  high_at_rest: {
    label: 'Heart rate high, body still',
    blurb: 'Well above your resting rate, without the effort that usually explains it.',
    refs: ['Psalm 94:19', 'Philippians 4:6', 'Isaiah 41:10', 'Psalm 55:22', 'John 14:27', 'Matthew 6:34'],
  },
  elevated_at_rest: {
    label: 'Heart rate up, body still',
    blurb: 'Above your resting rate while you have been sitting.',
    refs: ['Psalm 46:10', 'Isaiah 26:3', '1 Peter 5:7', 'Psalm 23:2', 'Matthew 11:28', 'Psalm 62:1'],
  },
  settling: {
    label: 'Coming back down',
    blurb: 'Your heart rate is falling back toward where it rests.',
    refs: ['Psalm 116:7', 'Psalm 131:2', 'Mark 4:39', 'Psalm 3:5', 'Zephaniah 3:17'],
  },

  // --- breathwork -----------------------------------------------------------
  // Keyed to what a pattern is *for*, so the scripture matches the intent of
  // the breathing rather than being generic calm.
  breath_steady: {
    label: 'Steadying before effort',
    blurb: 'Calm and alert at the same time.',
    refs: ['Isaiah 26:3', 'Joshua 1:9', 'Psalm 27:1', 'Proverbs 4:25', '2 Timothy 1:7'],
  },
  breath_rest: {
    label: 'Coming to rest',
    blurb: 'Slowing down on purpose.',
    refs: ['Psalm 46:10', 'Matthew 11:28', 'Psalm 23:2', 'Psalm 62:1', 'Mark 6:31'],
  },
  breath_sleep: {
    label: 'Winding down',
    blurb: 'Letting the day end.',
    refs: ['Psalm 4:8', 'Psalm 127:2', 'Proverbs 3:24', 'Psalm 3:5', 'Matthew 11:29'],
  },
  breath_wake: {
    label: 'Waking up',
    blurb: 'The start of a day.',
    refs: ['Lamentations 3:23', 'Psalm 143:8', 'Genesis 2:7', 'Psalm 5:3', 'Psalm 118:24'],
  },
  breath_done: {
    label: 'After breathing',
    blurb: 'The minutes just after.',
    refs: ['Psalm 116:7', 'Philippians 4:7', 'Psalm 131:2', 'Isaiah 30:15', 'John 14:27'],
  },
};

// Which context a breathing pattern belongs to. Read from the pattern's own
// purpose rather than duplicated, so adding a pattern does not silently fall
// through to generic calm.
const PATTERN_CONTEXT = {
  box: 'breath_steady',
  'road-cadence': 'breath_steady',
  coherent: 'breath_rest',
  'extended-exhale': 'breath_rest',
  'physiological-sigh': 'breath_rest',
  'four-seven-eight': 'breath_sleep',
  'first-light': 'breath_wake',
};

function contextForPattern(key) {
  return PATTERN_CONTEXT[key] || 'breath_rest';
}

/**
 * Classify a heart-rate reading taken while the body is still.
 *
 * @param {object} t
 *   hr           current heart rate — ONLY from a real monitor, else null
 *   recent_hr    recent samples, oldest first
 *   resting_hr   the member's own measured resting rate (required)
 *   max_hr       max HR for reserve maths (required)
 *   moving       true if they are walking/training right now
 *
 * @returns {{context:string|null, status:string, label?, blurb?, measured:boolean,
 *            reason:string, hr:number|null, resting_hr:number|null,
 *            above_resting:number|null, reserve_fraction:number|null,
 *            missing?:string, hint?:string}}
 */
function classifyRest(t) {
  const hr = Number.isFinite(Number(t.hr)) && Number(t.hr) > 0 ? Number(t.hr) : null;
  const resting = Number(t.resting_hr) || null;
  const max = Number(t.max_hr) || null;

  const none = (status, missing, hint) => ({
    context: null, status, measured: false, reason: hint, hr, resting_hr: resting,
    above_resting: null, reserve_fraction: null, missing, hint,
  });

  // Movement explains an elevated rate, so we do not comment on one.
  if (t.moving) {
    return none('moving', null,
      'You are moving — an elevated heart rate is expected, so nothing is read into it.');
  }
  if (hr === null) {
    return none('no_monitor', 'hr',
      'Connect a heart-rate monitor to use this. Nothing here is inferred without one.');
  }
  if (!resting) {
    return none('no_baseline', 'resting_hr',
      'Add your resting heart rate in your profile. "Elevated" is a comparison, ' +
      'and comparing to an estimate would not mean anything.');
  }
  if (!max || max <= resting) {
    return none('no_max', 'max_hr',
      'Add your birth year or max heart rate so the comparison can be scaled to you.');
  }

  // The reading has to hold. A single sample is a twitch, not a state.
  const recent = (t.recent_hr || []).map(Number).filter(n => Number.isFinite(n) && n > 0);
  const samples = recent.length ? recent : [hr];
  const sustained = samples.length >= MIN_SAMPLES;
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;

  const reserve = max - resting;
  const frac = (avg - resting) / reserve;
  const above = Math.round(avg - resting);

  const out = (context, reason) => ({
    context,
    status: 'ok',
    label: CONTEXTS[context].label,
    blurb: CONTEXTS[context].blurb,
    measured: true,
    reason,
    hr: Math.round(avg),
    resting_hr: resting,
    above_resting: above,
    reserve_fraction: Math.round(frac * 100) / 100,
  });

  if (!sustained && frac >= ELEVATED_FRACTION) {
    return none('unsettled', null,
      'One high reading is not a state — keep the monitor on for a few more seconds.');
  }

  // Falling back toward resting after having been up.
  if (samples.length >= MIN_SAMPLES) {
    const half = Math.floor(samples.length / 2);
    const first = samples.slice(0, half).reduce((a, b) => a + b, 0) / half;
    const last = samples.slice(-half).reduce((a, b) => a + b, 0) / half;
    const wasUp = (first - resting) / reserve >= ELEVATED_FRACTION;
    if (wasUp && last < first - 5 && frac < HIGH_FRACTION) {
      return out('settling', `Down about ${Math.round(first - last)} bpm over these readings, ` +
                             `now ${above} above your resting rate.`);
    }
  }

  if (frac >= HIGH_FRACTION) {
    return out('high_at_rest',
      `${above} bpm above your resting rate of ${resting}, with no movement to account for it.`);
  }
  if (frac >= ELEVATED_FRACTION) {
    return out('elevated_at_rest',
      `${above} bpm above your resting rate of ${resting}, sitting still.`);
  }
  if (frac <= SETTLED_FRACTION) {
    return none('calm', null,
      `${Math.round(avg)} bpm — close to your resting rate. Nothing to flag.`);
  }
  return none('calm', null, `${Math.round(avg)} bpm — within normal range for you at rest.`);
}

/** Which breathing pattern suits a context, by key into lib/breathwork.js. */
function suggestPattern(context) {
  switch (context) {
    case 'high_at_rest': return 'physiological-sigh';   // fastest to take effect
    case 'elevated_at_rest': return 'extended-exhale';
    case 'settling': return 'coherent';
    default: return null;
  }
}

function pickRef(context, seenRefs) {
  const c = CONTEXTS[context];
  if (!c) return null;
  const seen = new Set(seenRefs || []);
  const fresh = c.refs.filter(r => !seen.has(r));
  return fresh.length ? fresh[0] : null;
}

module.exports = {
  CONTEXTS, classifyRest, contextForPattern, suggestPattern, pickRef,
  ELEVATED_FRACTION, HIGH_FRACTION, MIN_SAMPLES,
};
