/**
 * Guided breathing patterns.
 *
 * Each of these is an established technique with a real physiological rationale,
 * not a shape invented to look nice on a timer. Where a pattern claims an
 * effect, that claim is the well-documented one and is stated plainly rather
 * than dressed up: a longer exhale than inhale biases toward the parasympathetic
 * side, a double inhale reinflates collapsed alveoli, and so on.
 *
 * The scripture attached to each is a reference only. As everywhere else in this
 * app the text is resolved from the verified public-domain table at call time,
 * and a reference that will not resolve is surfaced as a reference alone rather
 * than being filled in from memory.
 */
'use strict';

// kind drives the animation: the circle grows on 'in', holds on 'hold',
// shrinks on 'out'.
const PATTERNS = [
  {
    key: 'box',
    name: 'Box breathing',
    tagline: 'Steady yourself before effort',
    about: 'Four equal sides. Used by people who need to be calm and alert at the same time, which is exactly the state you want on a start line.',
    scripture_ref: 'Isaiah 26:3',
    default_minutes: 3,
    phases: [
      { label: 'Breathe in', sec: 4, kind: 'in' },
      { label: 'Hold', sec: 4, kind: 'hold' },
      { label: 'Breathe out', sec: 4, kind: 'out' },
      { label: 'Hold', sec: 4, kind: 'hold' },
    ],
  },
  {
    key: 'coherent',
    name: 'Coherent breathing',
    tagline: 'Come to rest',
    about: 'Around five and a half breaths a minute, where breathing and heart rhythm tend to fall into step. The slowest pattern here, and the easiest to keep going.',
    scripture_ref: 'Psalm 46:10',
    default_minutes: 5,
    phases: [
      { label: 'Breathe in', sec: 5.5, kind: 'in' },
      { label: 'Breathe out', sec: 5.5, kind: 'out' },
    ],
  },
  {
    key: 'extended-exhale',
    name: 'Longer out than in',
    tagline: 'Let the day go',
    about: 'A longer exhale than inhale. The simplest way to settle: nothing to count but two numbers, and it works while you are still walking.',
    scripture_ref: 'Matthew 11:28',
    default_minutes: 4,
    phases: [
      { label: 'Breathe in', sec: 4, kind: 'in' },
      { label: 'Breathe out', sec: 6, kind: 'out' },
    ],
  },
  {
    key: 'four-seven-eight',
    name: 'Four, seven, eight',
    tagline: 'Wind down for sleep',
    about: 'In for four, hold for seven, out for eight. Deliberately demanding at first; it gets comfortable after a few rounds. Best sitting or lying down.',
    scripture_ref: 'Psalm 4:8',
    default_minutes: 4,
    phases: [
      { label: 'Breathe in', sec: 4, kind: 'in' },
      { label: 'Hold', sec: 7, kind: 'hold' },
      { label: 'Breathe out', sec: 8, kind: 'out' },
    ],
  },
  {
    key: 'physiological-sigh',
    name: 'The double breath',
    tagline: 'Settle quickly',
    about: 'Two inhales through the nose, the second short and on top of the first, then a long exhale. The fastest of these to take effect — a minute or two is enough.',
    scripture_ref: 'Psalm 62:1',
    default_minutes: 2,
    phases: [
      { label: 'Breathe in', sec: 3, kind: 'in' },
      { label: 'Sip more air', sec: 1, kind: 'in' },
      { label: 'Long breath out', sec: 6, kind: 'out' },
    ],
  },
  {
    key: 'road-cadence',
    name: 'Road cadence',
    tagline: 'Find your rhythm',
    about: 'Three steps in, two steps out. A running cadence rather than a resting one — practise it standing still and it is there when you need it on a hill.',
    scripture_ref: 'Isaiah 40:31',
    default_minutes: 3,
    phases: [
      { label: 'In · two · three', sec: 3, kind: 'in' },
      { label: 'Out · two', sec: 2, kind: 'out' },
    ],
  },
  {
    key: 'first-light',
    name: 'First light',
    tagline: 'Wake up gently',
    about: 'A fuller inhale than exhale, which nudges you the other way — toward alert. For mornings, or before you set off.',
    scripture_ref: 'Genesis 2:7',
    default_minutes: 2,
    phases: [
      { label: 'Breathe in', sec: 5, kind: 'in' },
      { label: 'Breathe out', sec: 3, kind: 'out' },
    ],
  },
];

function cycleSeconds(p) {
  return p.phases.reduce((a, ph) => a + ph.sec, 0);
}

/**
 * The catalogue, with verse text resolved. `resolve` is injected so this module
 * does not reach into the journeys module for a lookup.
 */
function list(resolve) {
  return PATTERNS.map(p => ({
    key: p.key,
    name: p.name,
    tagline: p.tagline,
    about: p.about,
    phases: p.phases,
    cycle_sec: cycleSeconds(p),
    breaths_per_min: Math.round((60 / cycleSeconds(p)) * 10) / 10,
    default_minutes: p.default_minutes,
    scripture_ref: p.scripture_ref,
    // Real text or nothing. Never written out here.
    scripture_text: (typeof resolve === 'function' ? resolve(p.scripture_ref) : null) || null,
  }));
}

function byKey(key) {
  return PATTERNS.find(p => p.key === key) || null;
}

module.exports = { PATTERNS, list, byKey, cycleSeconds };
