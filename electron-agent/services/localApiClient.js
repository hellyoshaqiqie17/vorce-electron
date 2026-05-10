"use strict";

const config = require("../core/config");
const { withRetry } = require("../utils/retry");

let runtime = null;

function configure(next) {
  runtime = next && next.baseUrl && next.secret ? { ...next } : null;
}

function isConfigured() {
  return Boolean(runtime?.baseUrl && runtime?.secret);
}

function buildUrl(path) {
  if (!isConfigured()) {
    throw new Error("Local monitoring API belum berjalan.");
  }
  const base = runtime.baseUrl.replace(/\/+$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}

async function request(method, path, body) {
  return withRetry(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.http.timeoutMs);

    try {
      const res = await fetch(buildUrl(path), {
        method,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-VORCE-Agent-Secret": runtime.secret,
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });

      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        const message = payload?.error || `${method} ${path} failed with ${res.status}`;
        const err = new Error(message);
        err.status = res.status;
        throw err;
      }
      return payload;
    } finally {
      clearTimeout(timer);
    }
  }, {
    retries: 1,
    baseDelayMs: 500,
    shouldRetry: (err) => !err.status || err.status >= 500,
  });
}

function registerDevice(payload) {
  return request("POST", "/api/device/register", payload);
}

function sendMetrics(payload) {
  return request("POST", "/api/device/metrics", payload);
}

function updateStatus(payload) {
  return request("PATCH", "/api/device/status", payload);
}

function heartbeat(payload) {
  return request("POST", "/api/device/heartbeat", payload);
}

function upsertActivitySession(payload) {
  return request("POST", "/api/device/activity-session", payload);
}

function upsertPresence(payload) {
  return request("POST", "/api/device/presence", payload);
}

function writeFinalizedSession(payload) {
  return request("POST", "/api/device/session", payload);
}

function writeSnapshot(payload) {
  return request("POST", "/api/device/snapshot", payload);
}

function writeAnomaly(payload) {
  return request("POST", "/api/device/anomaly", payload);
}

function writeDailyAnalytics(payload) {
  return request("POST", "/api/device/analytics/daily", payload);
}

function writeWeeklyAnalytics(payload) {
  return request("POST", "/api/device/analytics/weekly", payload);
}

function writeMonthlyAnalytics(payload) {
  return request("POST", "/api/device/analytics/monthly", payload);
}

module.exports = {
  configure,
  isConfigured,
  registerDevice,
  sendMetrics,
  updateStatus,
  heartbeat,
  upsertActivitySession,
  upsertPresence,
  writeFinalizedSession,
  writeSnapshot,
  writeAnomaly,
  writeDailyAnalytics,
  writeWeeklyAnalytics,
  writeMonthlyAnalytics,
};
