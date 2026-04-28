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

  tick().catch(() => {});
  timer = setInterval(() => {
    tick().catch(() => {});
  }, config.metricsIntervalMs);
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
