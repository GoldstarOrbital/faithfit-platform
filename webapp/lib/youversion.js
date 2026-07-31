/**
 * YouVersion Platform API.
 *
 * The app's own Bible library is 22 books of public-domain text, ingested and
 * verified word-for-word. That was the honest ceiling: any reference outside
 * those books could only ever be shown as a reference, because inventing the
 * wording was never an option.
 *
 * This lifts the ceiling. The YouVersion Platform serves the whole canon in
 * eleven English translations, from the organisation that publishes them. So a
 * reference the local library cannot resolve is now looked up here instead of
 * being shown bare — and it is still real text from a real source, which is the
 * only thing that ever mattered.
 *
 * Everything here degrades. With no key configured, or the API unreachable, the
 * app behaves exactly as it did before: local text where we have it, a bare
 * reference where we do not. Nothing is ever filled in from nowhere.
 *
 * The contract below was established by probing the live API, not assumed:
 *   base    https://api.youversion.com/v1
 *   auth    x-yvp-app-key: <key>
 *   list    GET /bibles?language_ranges[]=eng
 *   text    GET /bibles/{id}/passages/{USFM}     e.g. /bibles/206/passages/ISA.40.31
 *   ranges  ISA.40.30-31   (NOT ISA.40.30-ISA.40.31, which 404s)
 */
'use strict';

const db = require('./db');

const BASE = 'https://api.youversion.com/v1';
const TIMEOUT_MS = 6000;

// engWEBUS — the same World English Bible the local library holds, so text
// fetched here reads continuously with text already stored.
const DEFAULT_VERSION = 206;

function apiKey() {
  return process.env.YOUVERSION_API_KEY || null;
}
function isConfigured() {
  return !!apiKey();
}

function init() {
  db.exec(`
    -- Fetched passages are cached permanently: scripture does not change, and a
    -- cache means the app keeps working when the API does not.
    CREATE TABLE IF NOT EXISTS yv_passages (
      version_id INTEGER NOT NULL,
      usfm TEXT NOT NULL,
      reference TEXT,
      content TEXT NOT NULL,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (version_id, usfm)
    );

    -- The canon itself: every book, and how many chapters and verses each has.
    -- Fetched once from /bibles/{id}/books, which returns the whole structure.
    --
    -- This is what lets the app know that Obadiah has one chapter and 21 verses
    -- without having ingested Obadiah. Before this, "is that a real reference?"
    -- could only be answered for the 22 books held locally, so a verse thread
    -- could not be opened on most of the Bible.
    CREATE TABLE IF NOT EXISTS yv_canon (
      book TEXT NOT NULL,
      chapter INTEGER NOT NULL,
      verses INTEGER NOT NULL,
      title TEXT,
      canon TEXT,
      position INTEGER,
      PRIMARY KEY (book, chapter)
    );

    CREATE TABLE IF NOT EXISTS yv_versions (
      id INTEGER PRIMARY KEY,
      abbreviation TEXT,
      title TEXT,
      deep_link TEXT,
      refreshed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

async function call(path, timeoutMs) {
  const key = apiKey();
  if (!key) return null;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs || TIMEOUT_MS);
  try {
    const res = await fetch(BASE + path, {
      headers: { 'x-yvp-app-key': key, accept: 'application/json' },
      signal: ac.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;                    // unreachable is not an error worth throwing
  } finally {
    clearTimeout(timer);
  }
}

// --- Books ------------------------------------------------------------------
// Reference book names to the USFM codes the API addresses passages by.
const USFM = {
  genesis: 'GEN', exodus: 'EXO', leviticus: 'LEV', numbers: 'NUM', deuteronomy: 'DEU',
  joshua: 'JOS', judges: 'JDG', ruth: 'RUT', '1samuel': '1SA', '2samuel': '2SA',
  '1kings': '1KI', '2kings': '2KI', '1chronicles': '1CH', '2chronicles': '2CH',
  ezra: 'EZR', nehemiah: 'NEH', esther: 'EST', job: 'JOB', psalm: 'PSA', psalms: 'PSA',
  proverbs: 'PRO', ecclesiastes: 'ECC', songofsolomon: 'SNG', songofsongs: 'SNG',
  isaiah: 'ISA', jeremiah: 'JER', lamentations: 'LAM', ezekiel: 'EZK', daniel: 'DAN',
  hosea: 'HOS', joel: 'JOL', amos: 'AMO', obadiah: 'OBA', jonah: 'JON', micah: 'MIC',
  nahum: 'NAM', habakkuk: 'HAB', zephaniah: 'ZEP', haggai: 'HAG', zechariah: 'ZEC',
  malachi: 'MAL', matthew: 'MAT', mark: 'MRK', luke: 'LUK', john: 'JHN', acts: 'ACT',
  romans: 'ROM', '1corinthians': '1CO', '2corinthians': '2CO', galatians: 'GAL',
  ephesians: 'EPH', philippians: 'PHP', colossians: 'COL', '1thessalonians': '1TH',
  '2thessalonians': '2TH', '1timothy': '1TI', '2timothy': '2TI', titus: 'TIT',
  philemon: 'PHM', hebrews: 'HEB', james: 'JAS', '1peter': '1PE', '2peter': '2PE',
  '1john': '1JN', '2john': '2JN', '3john': '3JN', jude: 'JUD', revelation: 'REV',
};

/**
 * "Isaiah 40:31" -> "ISA.40.31"; "Isaiah 40:30-31" -> "ISA.40.30-31".
 * Returns null for anything it cannot parse, rather than guessing.
 */
function toUsfm(reference) {
  const raw = String(reference || '').trim();
  // Book chapter:verse, optionally a verse range: "Isaiah 40:31", "Isaiah 40:30-31".
  let m = /^\s*((?:[123]\s*)?[A-Za-z][A-Za-z\s]*?)\s+(\d+)\s*:\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(raw);
  if (m) {
    const book = USFM[m[1].toLowerCase().replace(/[\s.]/g, '')];
    if (!book) return null;
    return book + '.' + m[2] + '.' + m[3] + (m[4] ? '-' + m[4] : '');
  }
  // A whole chapter, or a run of them: "Exodus 19", "Psalms 120-134". The
  // platform serves both, and several routes and challenges point at a chapter
  // rather than quoting a verse.
  m = /^\s*((?:[123]\s*)?[A-Za-z][A-Za-z\s]*?)\s+(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(raw);
  if (m) {
    const book = USFM[m[1].toLowerCase().replace(/[\s.]/g, '')];
    if (!book) return null;
    return book + '.' + m[2] + (m[3] ? '-' + m[3] : '');
  }
  return null;
}

// --- Versions ---------------------------------------------------------------
async function refreshVersions() {
  const json = await call('/bibles?language_ranges[]=eng');
  const list = json && Array.isArray(json.data) ? json.data : null;
  if (!list) return 0;
  const up = db.prepare(`INSERT INTO yv_versions (id, abbreviation, title, deep_link)
                         VALUES (?,?,?,?)
                         ON CONFLICT(id) DO UPDATE SET abbreviation=excluded.abbreviation,
                           title=excluded.title, deep_link=excluded.deep_link,
                           refreshed_at=datetime('now')`);
  db.exec('BEGIN');
  try {
    for (const b of list) {
      up.run(b.id, b.abbreviation || b.localized_abbreviation || null,
             b.title || b.localized_title || null, b.youversion_deep_link || null);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return list.length;
}

function versions() {
  return db.prepare('SELECT id, abbreviation, title, deep_link FROM yv_versions ORDER BY abbreviation').all();
}

// --- The canon --------------------------------------------------------------
/**
 * Fetch and store the whole canonical structure: 66 books (80 rows including
 * deuterocanon in some translations), their chapters, and the verse count of
 * each chapter.
 *
 * Runs once and is then permanent — the shape of the canon does not change.
 */
async function refreshCanon(versionId) {
  const vid = Number(versionId) || DEFAULT_VERSION;
  // This one response carries every verse address in the Bible — around 5
  // seconds to fetch and parse, which quietly exceeded the ordinary 6s budget
  // often enough that the canon simply never loaded. It runs once, so it gets
  // room rather than a retry loop.
  const json = await call('/bibles/' + vid + '/books', 45000);
  const list = json && Array.isArray(json.data) ? json.data : (Array.isArray(json) ? json : null);
  if (!list) return 0;

  const up = db.prepare(`INSERT INTO yv_canon (book, chapter, verses, title, canon, position)
                         VALUES (?,?,?,?,?,?)
                         ON CONFLICT(book, chapter) DO UPDATE SET verses=excluded.verses,
                           title=excluded.title, canon=excluded.canon, position=excluded.position`);
  let rows = 0;
  db.exec('BEGIN');
  try {
    list.forEach((b, i) => {
      for (const ch of (b.chapters || [])) {
        // Some entries carry non-numeric "chapters" (intros); those are not
        // addressable as chapter:verse and are skipped rather than stored as 0.
        const n = Number(ch.id);
        if (!Number.isFinite(n) || n < 1) continue;
        up.run(b.id, n, (ch.verses || []).length, b.title || null, b.canon || null, i);
        rows++;
      }
    });
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  return rows;
}

function canonLoaded() {
  try { return db.prepare('SELECT COUNT(*) c FROM yv_canon').get().c > 0; } catch { return false; }
}

/** Every book, with its chapter count — the index a developer navigates by. */
function books() {
  return db.prepare(`SELECT book, MAX(title) AS title, MAX(canon) AS canon,
                            COUNT(*) AS chapters, MIN(position) AS position
                       FROM yv_canon GROUP BY book ORDER BY position`).all();
}

function chapters(book) {
  return db.prepare('SELECT chapter, verses FROM yv_canon WHERE book = ? ORDER BY chapter')
    .all(String(book || '').toUpperCase());
}

/**
 * Does this reference exist in the canon?
 *
 * Distinct from "can we show its text" — this answers whether the address is
 * real, which is what lets the app accept a reference for a book it has never
 * ingested instead of rejecting it as unknown.
 *
 * Returns null when the canon has not been loaded, so callers can tell "no"
 * apart from "cannot say".
 */
function canonHas(reference) {
  if (!canonLoaded()) return null;
  const usfm = toUsfm(reference);
  if (!usfm) return false;
  const m = /^([A-Z0-9]{3})\.(\d+)(?:\.(\d+))?/.exec(usfm);
  if (!m) return false;
  const row = db.prepare('SELECT verses FROM yv_canon WHERE book = ? AND chapter = ?')
    .get(m[1], Number(m[2]));
  if (!row) return false;
  if (m[3] === undefined) return true;                 // a whole chapter
  return Number(m[3]) >= 1 && Number(m[3]) <= row.verses;
}

// --- Passages ---------------------------------------------------------------
/**
 * Real text for a reference, from cache or the API. Returns null when the key
 * is absent, the reference is unparseable, or the API has nothing — never a
 * placeholder.
 */
async function passage(reference, versionId) {
  const usfm = toUsfm(reference);
  if (!usfm) return null;
  const vid = Number(versionId) || DEFAULT_VERSION;

  const cached = db.prepare('SELECT reference, content FROM yv_passages WHERE version_id = ? AND usfm = ?')
    .get(vid, usfm);
  if (cached) return { reference: cached.reference, text: cached.content, version_id: vid, cached: true };

  if (!isConfigured()) return null;
  const json = await call('/bibles/' + vid + '/passages/' + encodeURIComponent(usfm));
  const content = json && typeof json.content === 'string' ? json.content.trim() : null;
  if (!content) return null;

  db.prepare(`INSERT INTO yv_passages (version_id, usfm, reference, content) VALUES (?,?,?,?)
              ON CONFLICT(version_id, usfm) DO UPDATE SET content=excluded.content,
                reference=excluded.reference, fetched_at=datetime('now')`)
    .run(vid, usfm, json.reference || reference, content);

  return { reference: json.reference || reference, text: content, version_id: vid, cached: false };
}

/** Where this reference lives on bible.com, so it can continue in YouVersion. */
function deepLink(reference, versionId) {
  const usfm = toUsfm(reference);
  if (!usfm) return null;
  const vid = Number(versionId) || DEFAULT_VERSION;
  // bible.com/bible/{version}/{BOOK.CH.VERSE}
  return 'https://www.bible.com/bible/' + vid + '/' + usfm;
}

/** Refresh the version list once at boot, quietly, if a key is present. */
function start() {
  init();
  if (!isConfigured()) {
    console.log('[youversion] no YOUVERSION_API_KEY — local library only, references outside it stay bare');
    return;
  }
  refreshVersions()
    .then(async (n) => {
      console.log('[youversion] %d English translations available', n);
      if (!canonLoaded()) {
        const rows = await refreshCanon(DEFAULT_VERSION).catch(() => 0);
        if (rows) console.log('[youversion] canon index loaded: %d chapters across %d books',
                              rows, books().length);
      }
      // Deliberately after boot, and never awaited: the app serves fine while
      // this fills in behind it.
      let lookupLocal = null;
      try { lookupLocal = require('./journeys').lookupScriptureText; } catch {}
      return backfillAuthoredRefs(lookupLocal);
    })
    .catch(() => console.log('[youversion] platform unavailable; cached and local text still serve'));
}


/**
 * Fetch and cache every reference the app itself authors that the local library
 * cannot resolve — journey waypoints, route epigraphs, challenge verses.
 *
 * This is what turns "most references resolve" into "they all do". It runs once
 * at boot, gently, and every result is cached permanently, so it costs one pass
 * and never repeats. A reference that still will not resolve is left alone and
 * shown as a reference, which is the behaviour this app has always had.
 */
async function backfillAuthoredRefs(lookupLocal) {
  if (!isConfigured()) return { attempted: 0, filled: 0 };

  const refs = new Set();
  const add = (r) => { if (r && typeof r === 'string') refs.add(r.trim()); };
  const q = (sql) => { try { return db.prepare(sql).all(); } catch { return []; } };

  for (const r of q('SELECT DISTINCT scripture_ref AS r FROM journey_waypoints WHERE scripture_ref IS NOT NULL')) add(r.r);
  for (const r of q('SELECT DISTINCT scripture_ref AS r FROM journeys WHERE scripture_ref IS NOT NULL')) add(r.r);
  for (const r of q('SELECT DISTINCT scripture_ref AS r FROM challenges WHERE scripture_ref IS NOT NULL')) add(r.r);

  // The moment and breathing catalogues are code, not rows.
  try { for (const m of Object.values(require('./moments').MOMENTS)) (m.refs || []).forEach(add); } catch {}
  try { for (const p of require('./breathwork').PATTERNS) add(p.scripture_ref); } catch {}

  let attempted = 0, filled = 0;
  for (const ref of refs) {
    if (typeof lookupLocal === 'function' && lookupLocal(ref)) continue;   // already have it
    attempted++;
    const got = await passage(ref, DEFAULT_VERSION);
    if (got) filled++;
    await new Promise(r => setTimeout(r, 120));    // be a polite client
  }
  if (attempted) console.log('[youversion] backfilled %d/%d references beyond the local library', filled, attempted);
  return { attempted, filled };
}

module.exports = {
  start, init, isConfigured, versions, refreshVersions, backfillAuthoredRefs,
  passage, deepLink, toUsfm, DEFAULT_VERSION,
  refreshCanon, canonLoaded, canonHas, books, chapters,
};
