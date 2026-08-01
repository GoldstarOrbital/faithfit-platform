/**
 * What the reels feed is made of.
 *
 * Every entry here is a SEARCH, never a video ID. That is not a stylistic
 * preference — a hardcoded eleven-character YouTube ID that nobody verified
 * resolves to *some* real video, and the one thing this app cannot do is put an
 * unknown video in front of a family audience because a plausible-looking
 * string was typed into a file. Searches are executed against the real API,
 * with safeSearch strict, and only what comes back is stored.
 *
 * Two kinds of source:
 *
 *   channels  a real publisher exists, so take their uploads. Best quality,
 *             most stable, least likely to vanish.
 *   queries   the material is spread across many uploaders (film edits,
 *             television clips). Searched as video, and re-checked for life
 *             because unofficial uploads get taken down constantly.
 */
'use strict';

// --- Categories -------------------------------------------------------------
// `weight` drives how much of the feed a category may occupy (see lib/reels.js).
// `tone` is carried through to the client so a card can be labelled honestly.
const CATEGORIES = {
  motivation: {
    label: 'Grit + perseverance',
    weight: 3,
    channels: [
      'David Goggins official',
      'Nick Bare Fitness official',
    ],
    queries: [
      'David Goggins motivation speech short',
      'David Goggins stay hard discipline',
      'Rocky Balboa inspirational speech scene',
      'Rocky how hard you can get hit and keep moving forward',
      'Creed training montage motivation edit',
      'Rocky training montage motivation edit',
    ],
  },

  inklings: {
    label: 'Lewis + Tolkien',
    weight: 3,
    channels: [
      'CSLewisDoodle',
      'Tolkien Untangled',
    ],
    queries: [
      'C.S. Lewis Mere Christianity explained',
      'C.S. Lewis original BBC recording',
      'C.S. Lewis on hope and joy quote',
      'C.S. Lewis problem of pain philosophy',
      'J.R.R. Tolkien interview recording',
      'Tolkien on myth and Christianity Lewis conversation',
      'Tolkien eucatastrophe on fairy stories',
      'Lord of the Rings Samwise there is some good in this world speech',
    ],
  },

  prairie: {
    label: 'Walnut Grove',
    weight: 2,
    channels: [
      'Little House on the Prairie official',
    ],
    queries: [
      'Little House on the Prairie best moments clip',
      'Little House on the Prairie Charles Ingalls lesson scene',
      'Little House on the Prairie faith scene',
      'Little House on the Prairie Laura and Pa moment',
    ],
  },

  // Michael Landon again, as Jonathan Smith — a probationary angel sent to help
  // people, 1984-89. Sits naturally beside Walnut Grove and carries the same
  // plainly-moral tone, so the two share a slot in the mix.
  highway: {
    label: 'Highway to Heaven',
    weight: 2,
    channels: [
      'Highway to Heaven official',
    ],
    queries: [
      'Highway to Heaven Michael Landon best scene',
      'Highway to Heaven Jonathan Smith angel clip',
      'Highway to Heaven Mark and Jonathan moment',
    ],
  },
};

// --- Safety -----------------------------------------------------------------
// safeSearch=strict is YouTube's filter and it is not sufficient on its own.
// David Goggins in particular is genuinely profane — the man swears constantly,
// and a compilation titled innocuously can open with it. This is a Christian
// family app; a parent handing a child the reels tab has to be safe.
//
// Two layers, and they do different jobs:
//   BLOCK  refuses the video outright.
//   FLAG   keeps it but marks it, so the client can badge it and it can be
//          excluded from a family-safe view rather than silently dropped.
const BLOCK = new RegExp([
  // carried over from the existing library filter
  'porn', 'sex', 'onlyfans', 'cannabis', 'marijuana', 'weed', 'alcohol', 'beer',
  'wine', 'vodka', 'drug', 'steroid', 'anorexia', 'bulimia', 'purge',
  'starvation', 'pro[- ]ana', 'laxative',
  // explicit-language markers and adjacent themes we will not carry at all
  'explicit', 'uncensored', 'nsfw', 'gore', 'suicide', 'self[- ]harm',
].map(w => `\\b${w}\\b`).join('|'), 'i');

// Titles that advertise profanity. Kept, but never shown to a family-safe feed.
const FLAG_LANGUAGE = /\b(swear|swearing|cuss|cussing|profanity|language warning|f\*+ck|f-bomb)\b/i;

// Categories where strong language is common enough that the flag is applied to
// the whole category rather than trusted to appear in a title.
const LANGUAGE_RISK = new Set(['motivation']);

function screen(video, category) {
  const text = `${video.title || ''} ${video.description || ''}`;
  if (BLOCK.test(text)) return { ok: false, reason: 'blocked_term' };
  const flagged = FLAG_LANGUAGE.test(text) || LANGUAGE_RISK.has(category);
  return { ok: true, language_flag: flagged ? 1 : 0 };
}

module.exports = { CATEGORIES, screen, BLOCK, FLAG_LANGUAGE, LANGUAGE_RISK };
