"use strict";

/**
 * Minimal fetch wrapper that:
 *   - Joins paths against the configured base URL.
 *   - Attaches Authorization: Bearer <token> when one is loaded.
 *   - Times out hung requests.
 *   - Throws ApiError with a stable shape so callers can pattern-match.
 *
 * IMPORTANT: this is the ONLY place that talks to the backend. There is no
 * Firestore client anywhere in this app — that is the backend's job.
 */

const config = require("../core/config");
const tokenStore = require("./tokenStore");
const { withRetry } = require("../utils/retry");
const { make } = require("../utils/logger");

const log = make("apiClient");

class ApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function buildUrl(path) {
  const base = config.apiBaseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

async function readBody(res) {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return await res.json();
    } catch (_) {
      return null;
    }
  }
  try {
    return await res.text();
  } catch (_) {
    return null;
  }
}

async function rawRequest(method, path, { body, auth = true, timeoutMs } = {}) {
  const url = buildUrl(path);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (auth) {
    const token = tokenStore.loadToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    timeoutMs ?? config.http.timeoutMs
  );

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });

    const payload = await readBody(res);

    if (!res.ok) {
      const message =
        (payload && (payload.message || payload.error)) ||
        `${method} ${path} failed with ${res.status}`;
      throw new ApiError(message, { status: res.status, body: payload });
    }

    return payload;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new ApiError(`${method} ${path} timed out`, { status: 0 });
    }
    if (err instanceof ApiError) throw err;
    throw new ApiError(err.message || "Network error", { status: 0 });
  } finally {
    clearTimeout(timer);
  }
}

function isTransient(err) {
  if (!(err instanceof ApiError)) return true;
  if (err.status === 0) return true; // network / timeout
  if (err.status >= 500 && err.status <= 599) return true;
  if (err.status === 408 || err.status === 429) return true;
  return false;
}

async function request(method, path, opts = {}) {
  const retries = opts.retries ?? config.http.retries;
  const baseDelayMs = opts.retryBaseDelayMs ?? config.http.retryBaseDelayMs;
  return withRetry(() => rawRequest(method, path, opts), {
    retries,
    baseDelayMs,
    shouldRetry: (err) => {
      const ok = isTransient(err);
      if (!ok) {
        log.debug("non-retryable error", { status: err.status });
      }
      return ok;
    },
  });
}

module.exports = {
  ApiError,
  request,
  post: (path, body, opts) => request("POST", path, { ...opts, body }),
  get: (path, opts) => request("GET", path, opts),
};
