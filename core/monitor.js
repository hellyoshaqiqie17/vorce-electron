"use strict";

/**
 * Monitor orchestrator.
 *
 * Pulls a sample from every collector on a fixed cadence, ships it through
 * `metricsService`, and emits the latest sample on a callback so the
 * renderer can show a live dashboard without ever hitting the network
 * directly.
 *
 * The loop is failure-tolerant: a single collector error or a single failed
 * push must never stop the agent. Errors are logged and the next tick
 * tries again.
 */

const config = require("./config");
const { getCpuUsage } = require("../collectors/cpu");
const { getMemoryUsage } = require("../collectors/memory");
const { getActiveApp } = require("../collectors/activity");
const { getIdle } = require("../collectors/idle");
const deviceService = require("../services/deviceService");
const metricsService = require("../services/metricsService");
const { make } = require("../utils/logger");

const log = make("monitor");

let timer = null;
let running = false;
let onSample = null;

async function settle(promise, fallback) {
  try {
    return await promise;
  } catch (err) {
    log.warn("collector failed", { err: err.message });
    return fallback;
  }
}

async function takeSample() {
  const [cpu, ram, activeApp] = await Promise.all([
    settle(getCpuUsage(), 0),
    settle(getMemoryUsage(), 0),
    settle(getActiveApp(), { name: "", title: "" }),
  ]);
  // idle is sync (powerMonitor); wrap to keep the shape consistent.
  const idle = getIdle();

  return {
    timestamp: Math.floor(Date.now() / 1000),
    cpu,
    ram,
    activeApp,
    idle,
  };
}

async function tick() {
  if (!running) return;

  const deviceId = deviceService.getDeviceId();
  if (!deviceId) {
    log.warn("no deviceId yet, skipping tick");
    return;
  }

  let sample;
  try {
    sample = await takeSample();
  } catch (err) {
    log.error("sampling failed", { err: err.message });
    return;
  }

  // Always notify the renderer so the live dashboard updates even when the
  // upload fails (offline, backend hiccup, etc).
  if (typeof onSample === "function") {
    try {
      onSample({ ...sample, deviceId });
    } catch (_) {
      /* renderer subscriber blew up, ignore */
    }
  }

  try {
    await metricsService.sendMetrics({ deviceId, sample });
  } catch (err) {
    log.warn("metrics upload failed", {
      err: err.message,
      status: err.status,
    });
  }
}

function start({ onSample: cb } = {}) {
  if (running) return;
  running = true;
  onSample = cb || null;
  log.info("starting", { intervalMs: config.metricsIntervalMs });

  // Fire one sample immediately so the UI doesn't sit blank for 5 seconds.
  tick().catch(() => {});
  timer = setInterval(() => {
    tick().catch(() => {});
  }, config.metricsIntervalMs);
  // Don't keep the event loop alive just for this timer — the app window
  // and IPC handlers already do that.
  if (timer.unref) timer.unref();
}

function stop() {
  running = false;
  onSample = null;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  log.info("stopped");
}

function isRunning() {
  return running;
}

module.exports = { start, stop, isRunning, takeSample };
