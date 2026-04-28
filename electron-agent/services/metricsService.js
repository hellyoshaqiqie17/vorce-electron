"use strict";

/**
 * Metrics push.
 *
 *   POST /device/metrics
 *   Headers: Authorization: Bearer <token>
 *   Body:    { deviceId, timestamp, cpu, ram, activeApp, idle }
 *
 * Backend writes to: devices/{deviceId}/stats/{timestamp}
 *
 * The agent only knows its deviceId. userId/companyId are resolved
 * server-side from the bearer token.
 */

const config = require("../core/config");
const api = require("./apiClient");
const { make } = require("../utils/logger");

const log = make("metricsService");

function clampPercent(v) {
  if (typeof v !== "number" || Number.isNaN(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function buildPayload({ deviceId, sample }) {
  if (!deviceId) throw new Error("deviceId belum tersedia.");

  const activeApp = sample.activeApp || {};
  const idle = sample.idle || { isIdle: false, seconds: 0 };

  const safeActiveApp = {
    name: config.privacy.sendActiveAppName ? activeApp.name || "" : "",
    title: config.privacy.sendActiveWindowTitle ? activeApp.title || "" : "",
  };

  return {
    deviceId,
    timestamp: sample.timestamp || Math.floor(Date.now() / 1000),
    cpu: clampPercent(sample.cpu),
    ram: clampPercent(sample.ram),
    activeApp: safeActiveApp,
    idle: {
      isIdle: Boolean(idle.isIdle),
      seconds: Math.max(0, Math.round(Number(idle.seconds) || 0)),
    },
  };
}

async function sendMetrics(opts) {
  const payload = buildPayload(opts);
  await api.post(config.endpoints.deviceMetrics, payload, {
    retries: 1,
    retryBaseDelayMs: 500,
  });
  log.debug("metrics sent", { ts: payload.timestamp });
  return payload;
}

module.exports = {
  sendMetrics,
};
