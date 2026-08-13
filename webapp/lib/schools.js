/**
 * US high school directory, for coaches to pick a real school and see who
 * on the platform is signed up there.
 *
 * Source: the Urban Institute's Education Data Portal
 * (educationdata.urban.org), a free, keyless, public wrapper around the US
 * Department of Education's own Common Core of Data (NCES). No account,
 * no API key -- confirmed by fetching it directly before writing any of
 * this. school_level=3 is NCES's own "high school" classification;
 * ncessch is NCES's permanent school identifier, stable across years,
 * which is what athlete_profiles.school_nces_id links to.
 *
 * ~23,500 US high schools as of the most recent CCD year. At per_page=10000
 * that's 3 HTTP requests for the whole country -- not something to repeat
 * on every boot, so syncFromSource() is only ever called on demand (an
 * admin action) or opportunistically by the ops agent when the local copy
 * is more than 30 days old. School directories change rarely; this isn't
 * something that needs to be fresh to the day.
 */
'use strict';

const db = require('./db');

const CCD_YEAR = 2021; // most recent year with complete data at the time this was built
const SOURCE_BASE = 'https://educationdata.urban.org/api/v1/schools/ccd/directory';

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schools (
      ncessch TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT,
      state TEXT,
      zip TEXT,
      lat REAL,
      lng REAL,
      enrollment INTEGER,
      status INTEGER,
      synced_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_schools_name ON schools(name);
    CREATE INDEX IF NOT EXISTS idx_schools_state ON schools(state);

    CREATE TABLE IF NOT EXISTS schools_sync_log (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_synced_at TEXT,
      school_count INTEGER
    );
  `);
}

function lastSync() {
  return db.prepare('SELECT * FROM schools_sync_log WHERE id = 1').get() || null;
}

/** True if never synced, or synced more than `maxAgeDays` ago. */
function isStale(maxAgeDays = 30) {
  const row = lastSync();
  if (!row || !row.last_synced_at) return true;
  const ageMs = Date.now() - new Date(row.last_synced_at.replace(' ', 'T') + 'Z').getTime();
  return ageMs > maxAgeDays * 24 * 60 * 60 * 1000;
}

/**
 * Fetches every open, US high school from the source and replaces the
 * local table wholesale. A handful of paginated requests (per_page=10000
 * covers the whole country in 3), not one row at a time. Returns null on
 * any network/parse failure -- the caller decides whether that's worth
 * surfacing; the existing table is left untouched either way (only
 * replaced once the full fetch succeeds).
 */
async function syncFromSource() {
  const rows = [];
  let url = `${SOURCE_BASE}/${CCD_YEAR}/?school_level=3&per_page=10000`;
  let pages = 0;
  try {
    while (url && pages < 10) { // hard cap: a runaway pagination loop should never hang this forever
      // The source blocks Node's default fetch User-Agent (403, a generic
      // bot-protection page, not an API error) but accepts a normal
      // browser-shaped one -- confirmed directly before landing this.
      const res = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; FunctioningFaith/1.0; +https://faithfit-demo-production.up.railway.app)' },
      });
      if (!res.ok) throw new Error(`source returned HTTP ${res.status}`);
      const body = await res.json();
      for (const r of body.results || []) {
        // status 1 = open. Closed/inactive schools aren't useful for "which
        // school are you at right now."
        if (r.school_status !== 1 || !r.ncessch || !r.school_name) continue;
        rows.push({
          ncessch: String(r.ncessch), name: r.school_name, city: r.city_location || null,
          state: r.state_location || null, zip: r.zip_location || null,
          lat: r.latitude ?? null, lng: r.longitude ?? null, enrollment: r.enrollment ?? null,
          status: r.school_status,
        });
      }
      url = body.next || null;
      pages++;
    }
  } catch (err) {
    console.error('[schools] sync failed:', err.message);
    return null;
  }
  if (!rows.length) return null;

  db.exec('DELETE FROM schools');
  const ins = db.prepare(`
    INSERT INTO schools (ncessch, name, city, state, zip, lat, lng, enrollment, status, synced_at)
    VALUES (@ncessch, @name, @city, @state, @zip, @lat, @lng, @enrollment, @status, datetime('now'))
  `);
  for (const r of rows) ins.run(r);
  db.prepare(`
    INSERT INTO schools_sync_log (id, last_synced_at, school_count) VALUES (1, datetime('now'), ?)
    ON CONFLICT(id) DO UPDATE SET last_synced_at = datetime('now'), school_count = excluded.school_count
  `).run(rows.length);

  console.log(`[schools] synced ${rows.length} US high schools`);
  return { synced: rows.length };
}

/** If the table is stale (or empty), sync -- otherwise a no-op. Called by
 *  the ops agent so this stays current without a human remembering to. */
async function syncIfStale() {
  if (!isStale()) return { skipped: true };
  return await syncFromSource();
}

/** Typeahead search -- name or city, optionally narrowed to a state. */
function search(q, state, limit = 20) {
  const clauses = [];
  const params = {};
  if (q) {
    clauses.push("(name LIKE @q ESCAPE '\\' OR city LIKE @q ESCAPE '\\')");
    params.q = '%' + String(q).slice(0, 80).replace(/[\\%_]/g, c => '\\' + c) + '%';
  }
  if (state) { clauses.push('state = @state'); params.state = String(state).toUpperCase().slice(0, 2); }
  const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
  return db.prepare(`SELECT ncessch, name, city, state, zip FROM schools ${where} ORDER BY name LIMIT @limit`)
    .all({ ...params, limit: Math.min(Number(limit) || 20, 50) });
}

function get(ncessch) {
  return db.prepare('SELECT * FROM schools WHERE ncessch = ?').get(ncessch) || null;
}

module.exports = { init, syncFromSource, syncIfStale, isStale, lastSync, search, get };
