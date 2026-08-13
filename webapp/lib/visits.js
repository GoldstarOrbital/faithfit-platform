/**
 * Anonymous site visits -- "how many people actually load Functioning
 * Faith," independent of whether they ever sign in.
 *
 * admin.metrics()'s existing active_24h/active_7d only count AUTHENTICATED
 * sessions (user_sessions.last_seen_at), which is the right number for "how
 * many members are active" but cannot answer "how many people visit" --
 * someone reading the sign-in page, or a demo-profile browser who never
 * creates an account, is invisible to that query. This is the other half.
 *
 * No fingerprinting, no third-party analytics pixel, no PII: a random
 * opaque id in a first-party cookie (ff_vid), no different in kind from the
 * session cookie this app already sets, just unauthenticated. One row per
 * (visitor, day) -- UNIQUE constraint does the de-duplication, so a visitor
 * reloading the page fifty times in one day is still counted once for that
 * day. Disclosed in privacy.html.
 */
'use strict';

const crypto = require('crypto');
const db = require('./db');

const COOKIE_NAME = 'ff_vid';
const COOKIE_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000; // just past a year, mirrors typical analytics practice

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS site_visits (
      visitor_id TEXT NOT NULL,
      visit_date TEXT NOT NULL,
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (visitor_id, visit_date)
    );
    CREATE INDEX IF NOT EXISTS idx_site_visits_date ON site_visits(visit_date);
  `);
}

function readCookie(req, name) {
  const header = req.headers && req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/**
 * Express middleware. Mounted only on real page routes (never on /api,
 * never on static assets) -- a visit is someone loading a page, not every
 * XHR a page they already have open happens to make.
 */
function track(req, res, next) {
  try {
    let vid = readCookie(req, COOKIE_NAME);
    if (!vid || !/^[a-f0-9]{32}$/.test(vid)) {
      vid = crypto.randomBytes(16).toString('hex');
      res.cookie(COOKIE_NAME, vid, {
        maxAge: COOKIE_MAX_AGE_MS,
        httpOnly: true,
        sameSite: 'lax',
        secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      });
    }
    const today = new Date().toISOString().slice(0, 10);
    db.prepare('INSERT OR IGNORE INTO site_visits (visitor_id, visit_date) VALUES (?, ?)').run(vid, today);
  } catch (err) {
    console.error('[visits] track failed:', err.message); // a visit counter must never break the page it is counting
  }
  next();
}

function one(sql, ...args) { try { return db.prepare(sql).get(...args); } catch { return null; } }

function metrics() {
  return {
    unique_today: (one("SELECT COUNT(DISTINCT visitor_id) c FROM site_visits WHERE visit_date = date('now')") || {}).c || 0,
    unique_7d: (one("SELECT COUNT(DISTINCT visitor_id) c FROM site_visits WHERE visit_date > date('now','-7 days')") || {}).c || 0,
    unique_30d: (one("SELECT COUNT(DISTINCT visitor_id) c FROM site_visits WHERE visit_date > date('now','-30 days')") || {}).c || 0,
    unique_all_time: (one('SELECT COUNT(DISTINCT visitor_id) c FROM site_visits') || {}).c || 0,
  };
}

module.exports = { init, track, metrics };
