/**
 * Verse categories -- browsing Scripture by theme rather than by book/chapter
 * or an exact reference someone already has to know by heart.
 *
 * Starting scope, per the brief: the seven deadly sins (as a caution) paired
 * with the seven classical virtues that answer them (as the encouragement).
 * Every reference below is hand-picked and real; text itself is never
 * authored here -- it is always resolved from the app's own verified Bible
 * store (or the YouVersion fallback), the same path scriptureMission.js and
 * motivation.js already use, via lib/companion.js's resolveRef.
 */
'use strict';

const companion = require('./companion');

const CATEGORIES = [
  // --- Seven Deadly Sins, framed as a caution rather than condemnation ---
  {
    id: 'pride', label: 'Pride', kind: 'vice',
    refs: ['Proverbs 16:18', 'Proverbs 11:2', 'James 4:6', '1 Peter 5:5', 'Proverbs 8:13', 'Obadiah 1:3', 'Galatians 6:3', 'Romans 12:3'],
  },
  {
    id: 'greed', label: 'Greed', kind: 'vice',
    refs: ['Luke 12:15', '1 Timothy 6:10', 'Hebrews 13:5', 'Proverbs 28:25', 'Ecclesiastes 5:10', 'Matthew 6:24', 'Proverbs 15:27', 'Colossians 3:5'],
  },
  {
    id: 'lust', label: 'Lust', kind: 'vice',
    refs: ['Matthew 5:28', '1 Corinthians 6:18', 'Galatians 5:16', '1 Thessalonians 4:3', 'Job 31:1', '1 Peter 2:11', '2 Timothy 2:22', '1 John 2:16'],
  },
  {
    id: 'envy', label: 'Envy', kind: 'vice',
    refs: ['Proverbs 14:30', 'Galatians 5:26', 'James 3:16', '1 Corinthians 13:4', 'Proverbs 23:17', 'Titus 3:3', 'Psalm 37:1', '1 Peter 2:1'],
  },
  {
    id: 'gluttony', label: 'Gluttony', kind: 'vice',
    refs: ['Proverbs 23:21', 'Philippians 3:19', 'Proverbs 25:16', '1 Corinthians 6:19', 'Proverbs 23:2', 'Romans 13:14', 'Titus 2:12', '1 Corinthians 9:27'],
  },
  {
    id: 'wrath', label: 'Wrath', kind: 'vice',
    refs: ['Ephesians 4:26', 'James 1:19', 'Proverbs 15:1', 'Proverbs 14:29', 'Colossians 3:8', 'Ecclesiastes 7:9', 'Proverbs 29:11', 'James 1:20'],
  },
  {
    id: 'sloth', label: 'Sloth', kind: 'vice',
    refs: ['Proverbs 13:4', 'Proverbs 6:6', 'Proverbs 12:24', 'Proverbs 19:15', 'Ecclesiastes 10:18', 'Romans 12:11', '2 Thessalonians 3:10', 'Proverbs 18:9'],
  },
  // --- Seven Virtues, each answering the vice above it ---
  {
    id: 'humility', label: 'Humility', kind: 'virtue',
    refs: ['Micah 6:8', 'Philippians 2:3', 'James 4:10', 'Proverbs 22:4', 'Matthew 23:12', 'Colossians 3:12', '1 Peter 5:6', 'Philippians 2:8'],
  },
  {
    id: 'generosity', label: 'Generosity', kind: 'virtue',
    refs: ['2 Corinthians 9:7', 'Proverbs 11:25', 'Acts 20:35', 'Luke 6:38', 'Proverbs 19:17', '1 Timothy 6:18', '2 Corinthians 9:6', 'Hebrews 13:16'],
  },
  {
    id: 'chastity', label: 'Chastity', kind: 'virtue',
    refs: ['1 Corinthians 6:20', '1 Thessalonians 4:4', 'Psalm 119:9', 'Matthew 5:8', '1 Timothy 4:12', 'Psalm 51:10', 'James 4:8', '2 Corinthians 7:1'],
  },
  {
    id: 'kindness', label: 'Kindness', kind: 'virtue',
    refs: ['Ephesians 4:32', 'Galatians 5:22', 'Proverbs 11:17', 'Luke 6:35', 'Titus 3:4', 'Zechariah 7:9', 'Romans 12:10', '1 John 3:18'],
  },
  {
    id: 'temperance', label: 'Temperance', kind: 'virtue',
    refs: ['Galatians 5:23', '1 Corinthians 9:25', 'Proverbs 25:28', '1 Peter 4:7', 'Proverbs 23:20', 'Ephesians 5:18', '1 Thessalonians 5:6', 'Titus 2:12'],
  },
  {
    id: 'patience', label: 'Patience', kind: 'virtue',
    refs: ['James 5:8', 'Romans 12:12', 'Ecclesiastes 7:8', 'Proverbs 16:32', '1 Corinthians 13:4', 'Galatians 5:22', '2 Peter 3:9', 'Hebrews 10:36'],
  },
  {
    id: 'diligence', label: 'Diligence', kind: 'virtue',
    refs: ['Colossians 3:23', 'Proverbs 10:4', 'Proverbs 21:5', 'Romans 12:11', 'Proverbs 12:11', 'Ecclesiastes 9:10', 'Galatians 6:9', 'Hebrews 6:12'],
  },
];

function list() {
  return CATEGORIES.map(c => ({ id: c.id, label: c.label, kind: c.kind, count: c.refs.length }));
}

// Every ref above is authored here as "Book Chapter:Verse", and a local hit
// echoes that exact string back unchanged (see companion.resolveRef) -- so
// this is safe to split rather than needing a general-purpose parser. Shaped
// to match the native client's existing BibleVerse model (book/chapter/verse/
// text/translation) so the same view that browses by book can browse by
// category with no separate model or decode path.
function splitRef(ref) {
  const m = /^(.+)\s(\d+):(\d+)$/.exec(ref);
  return m ? { book: m[1], chapter: Number(m[2]), verse: Number(m[3]) } : null;
}

async function versesFor(id) {
  const cat = CATEGORIES.find(c => c.id === id);
  if (!cat) return null;
  const verses = [];
  for (const ref of cat.refs) {
    const hit = await companion.resolveRef(ref);
    const parsed = hit && splitRef(hit.reference);
    if (hit && parsed) verses.push({ ...parsed, text: hit.text, translation: hit.version_id ? null : 'WEB' });
  }
  return { id: cat.id, label: cat.label, kind: cat.kind, verses };
}

module.exports = { CATEGORIES, list, versesFor };
