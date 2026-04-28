"use strict";

/**
 * Run `fn` with exponential backoff. `shouldRetry(err)` decides whether an
 * error is transient and worth retrying.
 */
async function withRetry(fn, opts = {}) {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn(attempt);
    } catch (err) {
      attempt += 1;
      if (attempt > retries || !shouldRetry(err)) {
        throw err;
      }
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

module.exports = { withRetry };
