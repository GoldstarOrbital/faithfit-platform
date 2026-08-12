/**
 * The "notify me when it's on the App Store" list.
 *
 * A single public capture (no account needed -- someone deciding whether
 * this is worth an account yet is exactly who this is for) and a single
 * admin action that emails everyone on it once, when it's actually true.
 *
 * Same degrade pattern as every other email path in this app
 * (lib/account-security.js's reset email, lib/developer-verification.js's
 * accountability notice): without RESEND_API_KEY/EMAIL_FROM configured,
 * signups are still stored, the send simply reports "not configured"
 * instead of silently pretending to have emailed anyone.
 */
'use strict';

const { randomUUID } = require('crypto');
const db = require('./db');

function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS launch_notify_signups (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      notified_at TEXT
    );
  `);
}

function signup(email) {
  const clean = String(email || '').trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(clean)) return { ok: false, error: 'invalid_email' };
  db.prepare(`INSERT INTO launch_notify_signups (id, email) VALUES (?, ?)
              ON CONFLICT(email) DO NOTHING`).run(randomUUID(), clean);
  return { ok: true };
}

function stats() {
  const row = db.prepare(`SELECT COUNT(*) total, SUM(CASE WHEN notified_at IS NULL THEN 1 ELSE 0 END) pending
    FROM launch_notify_signups`).get();
  return { total: row.total || 0, pending: row.pending || 0 };
}

/**
 * Send the one-time "we're live" email to everyone not yet notified.
 * Individually addressed (not one big BCC) so a bad address for one person
 * cannot affect delivery to anyone else, and so each failure is attributable.
 */
async function notifyLaunch({ appStoreUrl, playStoreUrl } = {}) {
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return { sent: 0, failed: 0, configured: false };
  }
  const pending = db.prepare('SELECT id, email FROM launch_notify_signups WHERE notified_at IS NULL').all();
  let sent = 0, failed = 0;
  const links = [
    appStoreUrl ? `iOS: ${appStoreUrl}` : null,
    playStoreUrl ? `Android: ${playStoreUrl}` : null,
  ].filter(Boolean).join('\n');

  for (const row of pending) {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM,
          to: [row.email],
          subject: 'Functioning Faith is live on the App Store',
          text: `It's here.\n\nFunctioning Faith is now available to download.\n\n${links || 'Find it by searching "Functioning Faith" in the App Store or Google Play.'}\n\nThank you for waiting for this.`,
        }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`email_${response.status}`);
      db.prepare("UPDATE launch_notify_signups SET notified_at = datetime('now') WHERE id = ?").run(row.id);
      sent++;
    } catch (err) {
      failed++;
      console.error('[launch-notify] failed for %s: %s', row.email, err.message);
    }
  }
  return { sent, failed, configured: true };
}

module.exports = { init, signup, stats, notifyLaunch };
