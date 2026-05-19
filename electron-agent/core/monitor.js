"use strict";

/**
 * Monitor orchestrator.
 *
 * Pulls a sample from every collector on a fixed cadence, ships it via
 * metricsService, and emits each sample on a callback so the renderer
 * can show a live dashboard without hitting the network directly.
 *
 * Failure-tolerant: a single collector error or a single failed push
 * never stops the agent.
 */

const config = require("./config");
const { collectCpu } = require("../collectors/cpuCollector");
const { collectRam } = require("../collectors/ramCollector");
const { collectStorage } = require("../collectors/storageCollector");
const { collectActivity } = require("../collectors/activityCollector");
const { collectIdle } = require("../collectors/idleCollector");
const { collectNetwork } = require("../collectors/networkCollector");
const { collectProcess, collectTopProcesses } = require("../collectors/processCollector");
const deviceService = require("../services/deviceService");
const intelligence = require("../services/intelligence");
const localApiClient = require("../services/localApiClient");
const statsBatchBuffer = require("../services/statsBatchBuffer");
const { make } = require("../utils/logger");

const log = make("monitor");

let timer = null;
let running = false;
let onSample = null;
let lastFirestoreHeartbeatAt = 0;

async function settle(promise, fallback) {
  try {
    return await promise;
  } catch (err) {
    log.warn("collector failed", { err: err.message });
    return fallback;
  }
}

async function takeSample() {
  const activity = await settle(collectActivity(), {
    appName: "Unknown",
    windowTitle: "",
    executable: "",
    pid: 0,
  });
  const [cpu, ram, storage, network, processInfo, topProcesses] = await Promise.all([
    settle(collectCpu(), { usagePercent: 0, currentSpeedGHz: 0 }),
    settle(collectRam(), { usagePercent: 0, usedGB: 0, freeGB: 0, totalGB: 0 }),
    settle(collectStorage(), { usedGB: 0, freeGB: 0, usagePercent: 0 }),
    settle(collectNetwork(), { uploadKBps: 0, downloadKBps: 0, localIp: "", macAddress: "" }),
    settle(collectProcess(activity), {
      appName: activity.appName,
      windowTitle: activity.windowTitle,
      executable: activity.executable,
      pid: activity.pid,
    }),
    settle(collectTopProcesses(3), []),
  ]);
  const idle = collectIdle();

  return {
    timestamp: Math.floor(Date.now() / 1000),
    cpu,
    ram,
    storage,
    network: {
      uploadKBps: network.uploadKBps,
      downloadKBps: network.downloadKBps,
    },
    process: {
      appName: processInfo.appName || activity.appName || "Unknown",
      windowTitle: processInfo.windowTitle || activity.windowTitle || "",
      executable: processInfo.executable || activity.executable || "",
      pid: Number(processInfo.pid || activity.pid || 0) || 0,
      cpuPercent: Number(processInfo.cpuPercent) || 0,
      memoryMB: Number(processInfo.memoryMB) || 0,
    },
    idle,
    system: {
      uptimeSeconds: Math.round(process.uptime()),
    },
    activeApp: {
      name: processInfo.appName || activity.appName || "Unknown",
      title: processInfo.windowTitle || activity.windowTitle || "",
    },
    cpuUsage: cpu.usagePercent,
    ramUsage: ram.usagePercent,
    topProcesses,
  };
}

async function tick() {
  if (!running) return;

  let state;
  try {
    state = await deviceService.ensureRegistered();
  } catch (err) {
    log.warn("device registration not ready, skipping tick", { err: err.message });
    return;
  }
  const deviceId = state.deviceId;

  let sample;
  try {
    sample = await takeSample();
  } catch (err) {
    log.error("sampling failed", { err: err.message });
    return;
  }

  if (typeof onSample === "function") {
    try {
      onSample({ ...sample, deviceId });
    } catch (_) {
      /* renderer subscriber blew up, ignore */
    }
  }

  // New intelligence pipeline: local processing first, compressed writes only.
  try {
    await intelligence.process({ deviceId, binding: state.binding, sample });
  } catch (err) {
    log.warn("intelligence pipeline failed", { err: err.message, status: err.status });
  }

  try {
    statsBatchBuffer.observe({
      deviceId,
      binding: state.binding,
      sample,
      intervalSeconds: Math.max(1, Math.round(config.metricsIntervalMs / 1000)),
    });
  } catch (err) {
    log.warn("stats buffer observe failed", { err: err.message });
  }

  // Firestore heartbeat is disabled by default. Realtime presence is handled by RTDB.
  try {
    const now = Date.now();
    if (
      config.firestoreHeartbeatEnabled &&
      localApiClient.isConfigured() &&
      now - lastFirestoreHeartbeatAt >= config.firestoreHeartbeatMs
    ) {
      await localApiClient.heartbeat({ deviceId, binding: state.binding });
      lastFirestoreHeartbeatAt = now;
    }
  } catch (err) {
    log.debug("heartbeat skipped", { err: err.message });
  }
}

function start({ onSample: cb } = {}) {
  if (running) return;
  running = true;
  onSample = cb || null;
  intelligence.init({ intervalMs: config.metricsIntervalMs });
  intelligence.reset();
  statsBatchBuffer.start();
  lastFirestoreHeartbeatAt = 0;
  log.info("starting", { intervalMs: config.metricsIntervalMs });

  tick().catch(() => {});
  timer = setInterval(() => {
    tick().catch(() => {});
  }, config.metricsIntervalMs);
  if (timer.unref) timer.unref();
}

async function stop() {
  running = false;
  onSample = null;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  try {
    const state = deviceService.getRegistrationState();
    await intelligence.flush({ deviceId: state?.deviceId, binding: state?.binding });
    await statsBatchBuffer.stop({ flushFirestore: true });
  } catch (err) {
    log.warn("intelligence flush failed", { err: err.message });
  }
  intelligence.stop();
  log.info("stopped");
}

function isRunning() {
  return running;
}

module.exports = { start, stop, isRunning, takeSample };
