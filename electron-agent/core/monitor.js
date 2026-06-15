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
const { collectGpuUsage } = require("../collectors/gpuCollector");
const deviceService = require("../services/deviceService");
const intelligence = require("../services/intelligence");
const localApiClient = require("../services/localApiClient");
const statsBatchBuffer = require("../services/statsBatchBuffer");
const realtimePresenceStore = require("../services/realtimePresenceStore");
const { make } = require("../utils/logger");

const log = make("monitor");

let timer = null;
let running = false;
let onSample = null;
let lastFirestoreHeartbeatAt = 0;

const diagnosticsService = require("../services/diagnosticsService");

async function instrumentCollector(name, promise, fallback) {
  const startTime = Date.now();
  try {
    const result = await promise;
    diagnosticsService.recordCollector(name, Date.now() - startTime, true);
    return result;
  } catch (err) {
    diagnosticsService.recordCollector(name, Date.now() - startTime, false, err);
    log.warn(`collector ${name} failed`, { err: err.message });
    return fallback;
  }
}

async function takeSample() {
  const activity = await instrumentCollector("activity", collectActivity(), {
    appName: "Unknown",
    windowTitle: "",
    executable: "",
    pid: 0,
  });
  const [cpu, ram, storage, network, processInfo, topProcesses, gpuUsage] = await Promise.all([
    instrumentCollector("cpu", collectCpu(), { usagePercent: 0, currentSpeedGHz: 0 }),
    instrumentCollector("ram", collectRam(), { usagePercent: 0, usedGB: 0, freeGB: 0, totalGB: 0 }),
    instrumentCollector("disk", collectStorage(), { usedGB: 0, freeGB: 0, usagePercent: 0 }),
    instrumentCollector("network", collectNetwork(), { uploadKBps: 0, downloadKBps: 0, localIp: "", macAddress: "" }),
    instrumentCollector("activeWindow", collectProcess(activity), {
      appName: activity.appName,
      windowTitle: activity.windowTitle,
      executable: activity.executable,
      pid: activity.pid,
    }),
    instrumentCollector("application", collectTopProcesses(3), []),
    instrumentCollector("gpu", collectGpuUsage(), 0),
  ]);

  const startTimeIdle = Date.now();
  let idle;
  try {
    idle = collectIdle();
    diagnosticsService.recordCollector("idle", Date.now() - startTimeIdle, true);
  } catch (err) {
    diagnosticsService.recordCollector("idle", Date.now() - startTimeIdle, false, err);
    idle = { isIdle: false, idleTime: 0 };
  }

  return {
    timestamp: Math.floor(Date.now() / 1000),
    cpu,
    ram,
    storage,
    gpu: {
      usagePercent: gpuUsage,
    },
    network: {
      uploadKBps: network.uploadKBps,
      downloadKBps: network.downloadKBps,
      wifi: network.wifi || "",
      location: network.location || "Unknown",
      localIp: network.localIp || "",
      macAddress: network.macAddress || "",
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
    gpuUsage,
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

  try {
    realtimePresenceStore.startCommandListener(state.binding.companyId, deviceId);
  } catch (err) {
    log.warn("failed to start command listener", { err: err.message });
  }

  let sample;
  try {
    sample = await takeSample();
    diagnosticsService.recordPipelineStage("sample", true);
  } catch (err) {
    diagnosticsService.recordPipelineStage("sample", false, err);
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
    diagnosticsService.recordPipelineStage("intelligence", true);
  } catch (err) {
    diagnosticsService.recordPipelineStage("intelligence", false, err);
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
    realtimePresenceStore.stopCommandListener();
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
