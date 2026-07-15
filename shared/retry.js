/**
 * Exponential backoff retry wrapper shared by all third-party adapters.
 */
async function withRetry(fn, { retries = 4, baseDelayMs = 250, maxDelayMs = 8000 } = {}) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      const isRateLimited = err && err.rateLimited;
      const retryable = isRateLimited || (err && err.retryable);
      if (attempt > retries || !retryable) throw err;
      const delay = isRateLimited && err.retryAfter
        ? err.retryAfter * 1000
        : Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

module.exports = { withRetry };
