/**
 * A dependency-free request limiter. The app runs as one Railway instance
 * (server.js's SIGTERM handling is written for exactly that deployment
 * shape), so an in-process counter is correct here -- no second instance
 * for it to fail to coordinate with, and no new package needed for
 * something this small.
 *
 * Three tiers are actually mounted (see server.js and routes/api.js):
 *   - a generous per-IP flood guard across all of /api, so a scripted
 *     flood can no longer run up Railway compute unchecked;
 *   - a strict per-IP limit on the auth endpoints, against credential
 *     stuffing and signup spam;
 *   - a per-member limit on the handful of routes that call a metered,
 *     per-call external API (Gloo AI, chiefly) -- the direct guard
 *     against a runaway client or bug turning into a real bill.
 */
'use strict';

const buckets = new Map();

// Swept well after each bucket's own window closes, so this can never grow
// without bound without every caller having to remember to clean up.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > bucket.windowMs * 2) buckets.delete(key);
  }
}, 5 * 60 * 1000).unref();

/**
 * @param {object} o
 *   windowMs  the fixed window's length
 *   max       requests allowed per key per window
 *   keyFn     (req) => string; defaults to the client IP (trust proxy is set
 *             in server.js, so req.ip is the real client behind Railway)
 *   message   returned in the 429 body's `error` field
 */
function rateLimit(o) {
  const windowMs = o.windowMs;
  const max = o.max;
  const keyPrefix = o.keyPrefix || '';
  return (req, res, next) => {
    const rawKey = o.keyFn ? o.keyFn(req) : req.ip;
    const key = keyPrefix + ':' + (rawKey || req.ip || 'unknown');
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStart >= windowMs) {
      bucket = { windowStart: now, count: 0, windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfterSec = Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: o.message || 'rate_limited' });
    }
    next();
  };
}

/** Per-member key when signed in, falling back to IP for anonymous routes. */
function byUserOrIP(req) {
  return (req.session && req.session.userId) || req.ip;
}

module.exports = { rateLimit, byUserOrIP };
