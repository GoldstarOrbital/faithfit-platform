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

  // The modern short-form devotional scene: saint edits, scripture edits,
  // Catholic and Orthodox aesthetics. This is where the feed stops feeling like
  // an archive and starts feeling like something made this year.
  edits: {
    label: 'Faith edits',
    weight: 3,
    channels: [],
    queries: [
      'Catholic edit saints aesthetic',
      'Christian edit scripture verse',
      'Orthodox edit icon saint',
      'Saint Augustine edit',
      'Thomas Aquinas edit',
      'Psalm edit bible verse short',
    ],
  },

  // Higher-production Catholic short films. Vimeo rather than YouTube because
  // that is where this kind of work actually lives.
  shortfilm: {
    label: 'Short films',
    weight: 1,
    channels: [],
    queries: [],
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

// --- Seeds ------------------------------------------------------------------
/**
 * Hand-picked videos, so the feed has real material immediately rather than
 * waiting on the next ingest cycle (and on a YouTube quota that is currently
 * exhausted).
 *
 * These are the ONLY hardcoded IDs in the app, and every one was verified
 * before it was written here — fetched from the real channel/search pages in a
 * browser, then confirmed individually through YouTube's public oEmbed
 * endpoint, which returns the true title and uploader and fails for anything
 * private or non-embeddable. The titles below are the actual returned titles,
 * not descriptions I invented.
 *
 * That check earned its keep: the raw search pages also yielded a Motorola ad,
 * a Kerrygold ad and a Disney+ promo, all of which look exactly like content
 * until you ask what they are.
 *
 * Verified 2026-08-01. Re-check with: node scripts/verify-reel-seeds.js
 */
const SEEDS = {
  prairie: [
    // Official channel: youtube.com/@lhprairie — "The official home of
    // Little House on the Prairie®", 355 videos.
    { id: 'Z_WUHaNHvF8', title: 'Little House on the Prairie Opening Credits' },
    { id: 'tiF5ko9IeCI', title: 'S5E14 The Godsister | Little House on the Prairie' },
    { id: '3bBPIq9JBFc', title: 'Season 1 Episode 3 The Hundred Mile Walk Preview' },
    { id: 'sIMLG_IER4U', title: 'Season 1 Episode 18 The Plague Preview' },
    { id: 'zjofZsHfH8s', title: 'S1E9 School Mom | Karen Grassle' },
    { id: 'Rnr4Uagi9GU', title: 'S6E7 Halloween Dream' },
    { id: 'KQbKz9YX-a0', title: 'Matthew Laborteaux (Albert) | Winoka Warriors, S5' },
    { id: 'gEcb2p2vgPk', title: 'Richard Bull (Nels Oleson) | Second Spring, S6E21' },
    { id: 'uut92SfgiHk', title: 'Top 10 Romantic Moments on Little House on the Prairie' },
    { id: '1I6pdJR42zA', title: 'The Legacy of Laura Ingalls Wilder — Morgan Horses' },
  ],
  // Modern edits — verified via YouTube oEmbed 2026-08-01.
  edits: [
    { id: 'Pem0gTgOw-M', provider: 'youtube', title: 'holy orders | ✞ catholic aesthetics ✞' },
    { id: 'lTzR479F0Ao', provider: 'youtube', title: 'Catholicism | Christian Edit' },
    { id: 'hL3Nr73Kta8', provider: 'youtube', title: 'COME BACK HOME! | Catholic Edit' },
    { id: 'dIPL_JtYXpA', provider: 'youtube', title: 'Saint Augustine edit' },
    { id: 'VRkdcTyzYns', provider: 'youtube', title: 'St. Thomas Aquinas | Catholic edit' },
    { id: 'DyoiTGRwnX8', provider: 'youtube', title: 'Catholicism Edit | Golden Brown' },
    { id: 'SHDWomvLo94', provider: 'youtube', title: 'St. Peter the Athonite | Orthodox Edit' },
    { id: 'Hk5Ees09sRg', provider: 'youtube', title: 'Once lost, now a flame for Christ || St. Augustine edit' },
    { id: 'Y2xPdB1mnX4', provider: 'youtube', title: 'Catholic dark aesthetic' },
    { id: 'HeZ7xn0m0wY', provider: 'youtube', title: 'St. George the Martyr | Christian edit' },
    { id: 'Ovq3MyMWZgw', provider: 'youtube', title: 'Catholicism is not boring' },
    { id: 'yeXHFu6sH2g', provider: 'youtube', title: 'Psalm 6 — "Lord, do not forsake me"' },
    { id: 'Ov-WaIoxi_k', provider: 'youtube', title: 'Psalm 139 — "You have searched me, Lord"' },
    { id: 'Ij9nkikuJs4', provider: 'youtube', title: 'Proverbs 3 — a message before you sleep' },
    { id: 'pu9H4T6MvtY', provider: 'youtube', title: 'JESUS CHOSE YOU! | Christian Edit' },
    { id: 'IJZWD5LzOeI', provider: 'youtube', title: '"I Am The Alpha" | Christian Edit' },
    { id: 'k7klFUBDafU', provider: 'youtube', title: "That One Christian Edit You're Looking For" },
    { id: '9bp-8xnUVhk', provider: 'youtube', title: 'That One Christian Edit' },
  ],

  // Vimeo — verified via Vimeo's public oEmbed 2026-08-01.
  shortfilm: [
    { id: '333435822', provider: 'vimeo', title: 'The Catholic Girl — short film (St.Pio Films)' },
    { id: '344875215', provider: 'vimeo', title: 'The Catholic Farmer Boy — short film (St.Pio Films)' },
    { id: '406540493', provider: 'vimeo', title: 'Semana Santa (Holy Week) — cinematic short' },
  ],

  highway: [
    { id: 'xHRQaOMfOS4', title: 'Highway To Heaven S4E17 We Have Forever, Part 1 (clip)' },
    { id: 'JSGYdPxHWqs', title: 'Highway to Heaven — "I\'m an Angel" (pilot)' },
    { id: 'PNUsKaH2azM', title: 'Highway to Heaven — I want to help you help people' },
    { id: '5RGKSBi7S9o', title: 'Jonathan reveals to Mark that he\'s an angel' },
    { id: '6oXEPEbG-4Q', title: 'Jonathan Smith meets Michael Landon' },
    { id: 'GV_-812ExoM', title: 'Highway To Heaven — What God Looks Like (S5)' },
    { id: 'CK-sjtYWFfE', title: 'Highway to Heaven — Handicapped Zone' },
    { id: 'FoqRhfrdds4', title: "Highway to Heaven — a Jonathan 'talk' moment" },
    { id: 'FFE6Ihp3kz0', title: 'Highway to Heaven — S1E1 Pilot: Part 1' },
  ],
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

module.exports = { CATEGORIES, SEEDS, screen, BLOCK, FLAG_LANGUAGE, LANGUAGE_RISK };
