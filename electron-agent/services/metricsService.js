"use strict";

/**
 * Metrics push.
 *
 *   POST /api/device/metrics
 *   Headers: X-VORCE-Agent-Secret: <local-secret>
 *   Body:    { deviceId, binding, metric }
 *
 * Local API writes to:
 *   companies/{companyId}/device_monitoring/{deviceId}/live_metrics/{metricId}
 */

const config = require("../core/config");
const deviceService = require("./deviceService");
const localApiClient = require("./localApiClient");
const { make } = require("../utils/logger");

const log = make("metricsService");

const MIN_WRITE_INTERVAL_MS = 15000;
const FORCE_WRITE_INTERVAL_MS = 120000;
const HEARTBEAT_INTERVAL_MS = 30000;

let lastSentMetric = null;
let lastWriteAt = 0;
let lastHeartbeatAt = 0;

function toTimestamp(value) {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds;
  }
  return Math.floor(Date.now() / 1000);
}

function buildPayload({ sample }) {
  const processInfo = sample.process || {};
  const idle = sample.idle || { isIdle: false, idleSeconds: 0 };

  return {
    timestamp: toTimestamp(sample.timestamp),
    cpu: {
      usagePercent: Number(sample.cpu?.usagePercent ?? sample.cpuUsage) || 0,
      currentSpeedGHz: Number(sample.cpu?.currentSpeedGHz) || 0,
    },
    ram: {
      usagePercent: Number(sample.ram?.usagePercent ?? sample.ramUsage) || 0,
      usedGB: Number(sample.ram?.usedGB) || 0,
      freeGB: Number(sample.ram?.freeGB) || 0,
    },
    storage: {
      usedGB: Number(sample.storage?.usedGB) || 0,
      freeGB: Number(sample.storage?.freeGB) || 0,
      usagePercent: Number(sample.storage?.usagePercent) || 0,
    },
    network: {
      uploadKBps: Number(sample.network?.uploadKBps) || 0,
      downloadKBps: Number(sample.network?.downloadKBps) || 0,
    },
    process: {
      appName: config.privacy.sendActiveAppName ? processInfo.appName || "Unknown" : "",
      windowTitle: config.privacy.sendActiveWindowTitle ? processInfo.windowTitle || "" : "",
      executable: processInfo.executable || "",
      pid: Number(processInfo.pid) || 0,
    },
    idle: {
      isIdle: Boolean(idle.isIdle),
      idleSeconds: Math.max(0, Math.round(Number(idle.idleSeconds ?? idle.seconds) || 0)),
    },
    system: {
      uptimeSeconds: Math.max(0, Math.round(Number(sample.system?.uptimeSeconds) || 0)),
    },
  };
}

function changedEnough(previous, current, now) {
  if (!previous) return true;
  if (now - lastWriteAt >= FORCE_WRITE_INTERVAL_MS) return true;
  if (now - lastWriteAt < MIN_WRITE_INTERVAL_MS) return false;
  if (Math.abs(current.cpu.usagePercent - previous.cpu.usagePercent) >= 3) return true;
  if (Math.abs(current.cpu.currentSpeedGHz - previous.cpu.currentSpeedGHz) >= 0.2) return true;
  if (Math.abs(current.ram.usagePercent - previous.ram.usagePercent) >= 2) return true;
  if (Math.abs(current.ram.usedGB - previous.ram.usedGB) >= 0.25) return true;
  if (Math.abs(current.storage.usagePercent - previous.storage.usagePercent) >= 3) return true;
  if (Math.abs(current.network.uploadKBps - previous.network.uploadKBps) >= 25) return true;
  if (Math.abs(current.network.downloadKBps - previous.network.downloadKBps) >= 25) return true;
  if (current.process.appName !== previous.process.appName) return true;
  if (current.process.windowTitle !== previous.process.windowTitle) return true;
  if (current.process.pid !== previous.process.pid) return true;
  if (current.idle.isIdle !== previous.idle.isIdle) return true;
  if (Math.abs(current.idle.idleSeconds - previous.idle.idleSeconds) >= 60) return true;
  return false;
}

async function heartbeat(state, now) {
  if (now - lastHeartbeatAt < HEARTBEAT_INTERVAL_MS) return;
  await localApiClient.heartbeat({
    deviceId: state.deviceId,
    binding: state.binding,
  });
  lastHeartbeatAt = now;
}

async function sendMetrics(opts) {
  const payload = buildPayload(opts);
  let state = deviceService.getRegistrationState() || await deviceService.ensureRegistered();
  const now = Date.now();

  if (!changedEnough(lastSentMetric, payload, now)) {
    await heartbeat(state, now);
    log.debug("metrics skipped by suppression", { deviceId: state.deviceId });
    return payload;
  }

  try {
    await localApiClient.sendMetrics({
      deviceId: state.deviceId,
      binding: state.binding,
      metric: payload,
    });
  } catch (err) {
    log.warn("metrics write failed, refreshing registration", { err: err.message });
    state = await deviceService.registerDevice();
    await localApiClient.sendMetrics({
      deviceId: state.deviceId,
      binding: state.binding,
      metric: payload,
    });
  }
  lastSentMetric = payload;
  lastWriteAt = now;
  lastHeartbeatAt = now;
  log.debug("metrics sent", { deviceId: state.deviceId });
  return payload;
}

function resetFiltering() {
  lastSentMetric = null;
  lastWriteAt = 0;
  lastHeartbeatAt = 0;
}

module.exports = {
  sendMetrics,
  resetFiltering,
};
