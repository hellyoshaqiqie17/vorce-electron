"use strict";

const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const config = require("../core/config");
const realtimePresenceStore = require("./realtimePresenceStore");
const localApiClient = require("./localApiClient");
const semantic = require("./intelligence/semanticAnalyzer");
const { make } = require("../utils/logger");

const log = make("statsBatchBuffer");

let state = freshState();
let checkpointTimer = null;
let realtimeSummaryTimer = null;
let firestoreSummaryTimer = null;
let context = null;
let initialized = false;
let lastObservedAtSec = 0;

function bufferPath() {
  return path.join(app.getPath("userData"), config.storage.statsBufferFile);
}

function ensureDir() {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
}

function todayKey(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}

function freshState() {
  return {
    version: 1,
    date: todayKey(),
    companyId: null,
    userId: null,
    userEmail: null,
    userName: null,
    deviceId: null,
    location: "Unknown",
    totalOnlineSeconds: 0,
    totalActiveSeconds: 0,
    totalIdleSeconds: 0,
    sampleCount: 0,
    cpuSum: 0,
    cpuPeak: 0,
    ramSum: 0,
    ramPeak: 0,
    gpuSum: 0,
    gpuPeak: 0,
    switchCount: 0,
    anomalyCount: 0,
    currentApp: null,
    currentCategory: null,
    currentSessionStartedAt: null,
    apps: {},
    categories: {},
    productivity: {
      productiveSeconds: 0,
      neutralSeconds: 0,
      unproductiveSeconds: 0,
    },
    startedAt: Math.floor(Date.now() / 1000),
    lastSampleAt: 0,
    lastCheckpointAt: 0,
    lastRealtimeSummaryAt: 0,
    lastFirestoreSummaryAt: 0,
  };
}

function loadState() {
  try {
    const file = bufferPath();
    if (!fs.existsSync(file)) return freshState();
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return normalizeState(parsed);
  } catch (err) {
    log.warn("stats buffer unreadable, resetting", { err: err.message });
    return freshState();
  }
}

function normalizeState(next) {
  return {
    ...freshState(),
    ...(next && typeof next === "object" ? next : {}),
    gpuSum: Number(next?.gpuSum) || 0,
    gpuPeak: Number(next?.gpuPeak) || 0,
    apps: next?.apps && typeof next.apps === "object" ? next.apps : {},
    categories: next?.categories && typeof next.categories === "object" ? next.categories : {},
    productivity: {
      productiveSeconds: Number(next?.productivity?.productiveSeconds) || 0,
      neutralSeconds: Number(next?.productivity?.neutralSeconds) || 0,
      unproductiveSeconds: Number(next?.productivity?.unproductiveSeconds) || 0,
    },
  };
}

function persist() {
  ensureDir();
  state.lastCheckpointAt = Math.floor(Date.now() / 1000);
  fs.writeFileSync(bufferPath(), JSON.stringify(state, null, 2));
}

function resetForContext({ deviceId, binding }) {
  state = freshState();
  state.companyId = binding.companyId;
  state.userId = binding.userId;
  state.userEmail = binding.email || binding.userEmail || null;
  state.userName = binding.displayName || binding.userName || null;
  state.deviceId = deviceId;
  state.location = "Unknown";
  lastObservedAtSec = 0;
}

function ensureContext({ deviceId, binding }) {
  if (!binding?.companyId || !binding?.userId || !deviceId) return false;
  const date = todayKey();
  const changed = state.companyId !== binding.companyId || state.userId !== binding.userId || state.deviceId !== deviceId || state.date !== date;
  if (changed) resetForContext({ deviceId, binding });
  // Always refresh userEmail and userName from binding in case they were missing
  state.userEmail = binding.email || binding.userEmail || state.userEmail || null;
  state.userName = binding.displayName || binding.userName || state.userName || null;
  context = { deviceId, binding: { ...binding } };
  return true;
}

function addAppSeconds(app, category, seconds, cpu, ram) {
  const key = String(app || "Unknown").slice(0, 120) || "Unknown";
  if (!state.apps[key]) {
    state.apps[key] = {
      durationSeconds: 0,
      sessions: 0,
      cpuSum: 0,
      ramSum: 0,
      sampleCount: 0,
      category,
    };
  }
  const appStats = state.apps[key];
  appStats.durationSeconds += seconds;
  appStats.cpuSum += cpu;
  appStats.ramSum += ram;
  appStats.sampleCount += 1;
  appStats.category = category;
}

function addCategorySeconds(category, seconds) {
  const key = String(category || "Application");
  state.categories[key] = (state.categories[key] || 0) + seconds;
}

function addProductivitySeconds(category, seconds) {
  const score = semantic.productivityScoreFor(category);
  if (score >= 0.7) state.productivity.productiveSeconds += seconds;
  else if (score <= 0.25) state.productivity.unproductiveSeconds += seconds;
  else state.productivity.neutralSeconds += seconds;
}

function round1(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function summarizeApps() {
  const out = {};
  for (const [appName, stats] of Object.entries(state.apps)) {
    out[appName] = {
      durationSeconds: Math.round(stats.durationSeconds || 0),
      sessions: Number(stats.sessions) || 0,
      category: stats.category || "Application",
      cpuAverage: stats.sampleCount ? round1(stats.cpuSum / stats.sampleCount) : 0,
      ramAverage: stats.sampleCount ? round1(stats.ramSum / stats.sampleCount) : 0,
    };
  }
  return out;
}

function buildSummary({ final = false } = {}) {
  if (!state.companyId || !state.userId || !state.deviceId) return null;

  let cpuBrand = "Unknown CPU";
  let ramBrand = "Unknown Brand";
  let gpuBrand = "Unknown GPU";
  let ssdBrand = "Unknown SSD Brand";
  let hardware = null;

  try {
    const deviceService = require("./deviceService");
    const reg = deviceService.getRegistrationState();
    const info = reg?.info || {};

    cpuBrand = [info.cpu?.manufacturer, info.cpu?.brand || info.cpuModel].filter(Boolean).join(" ").trim() || "Unknown CPU";
    ramBrand = info.ram?.manufacturer || "Unknown Brand";
    gpuBrand = [info.gpu?.vendor, info.gpu?.model].filter(Boolean).join(" ").trim() || "Unknown GPU";
    ssdBrand = info.disk ? `${info.disk.vendor || ""} ${info.disk.name || "Unknown SSD"}`.trim().replace(/\s+/g, " ") : "Unknown SSD";

    hardware = {
      cpuBrand,
      gpuBrand,
      ramBrand,
      ssdBrand,
      cpu: {
        manufacturer: info.cpu?.manufacturer || "",
        brand: info.cpu?.brand || cpuBrand,
      },
      ram: {
        totalGB: Number(info.ram?.totalGB) || 0,
        type: info.ram?.type || "",
        manufacturer: ramBrand,
      },
      gpu: {
        vendor: info.gpu?.vendor || "",
        model: info.gpu?.model || "",
      },
      disk: {
        type: info.disk?.type || "",
        name: info.disk?.name || "",
        vendor: info.disk?.vendor || "",
      }
    };
  } catch (err) {
    log.warn("failed to resolve device registration state for hardware spec in summary", { err: err.message });
  }

  return {
    summaryId: `${state.userId}_${state.deviceId}_${state.date}`,
    companyId: state.companyId,
    userId: state.userId,
    userEmail: state.userEmail || "",
    userName: state.userName || "",
    deviceId: state.deviceId,
    date: state.date,
    final,
    location: state.location || "Unknown",
    totalOnlineSeconds: Math.round(state.totalOnlineSeconds),
    totalActiveSeconds: Math.round(state.totalActiveSeconds),
    totalIdleSeconds: Math.round(state.totalIdleSeconds),
    sampleCount: state.sampleCount,
    switchCount: state.switchCount,
    anomalyCount: state.anomalyCount,
    currentApp: state.currentApp || "Unknown",
    currentCategory: state.currentCategory || "Application",
    apps: summarizeApps(),
    categories: Object.fromEntries(Object.entries(state.categories).map(([k, v]) => [k, Math.round(v)])),
    productivity: {
      productiveSeconds: Math.round(state.productivity.productiveSeconds),
      neutralSeconds: Math.round(state.productivity.neutralSeconds),
      unproductiveSeconds: Math.round(state.productivity.unproductiveSeconds),
    },
    performance: {
      cpuAverage: state.sampleCount ? round1(state.cpuSum / state.sampleCount) : 0,
      cpuPeak: round1(state.cpuPeak),
      ramAverage: state.sampleCount ? round1(state.ramSum / state.sampleCount) : 0,
      ramPeak: round1(state.ramPeak),
      gpuAverage: state.sampleCount ? round1(state.gpuSum / state.sampleCount) : 0,
      gpuPeak: round1(state.gpuPeak),
    },
    cpuBrand,
    gpuBrand,
    ramBrand,
    ssdBrand,
    hardware,
    startedAt: state.startedAt,
    lastSampleAt: state.lastSampleAt,
    generatedAt: Math.floor(Date.now() / 1000),
  };
}

function observe({ deviceId, binding, sample, intervalSeconds = 5 }) {
  if (!ensureContext({ deviceId, binding })) return;

  state.location = sample?.network?.location || state.location || "Unknown";

  const nowSec = Number(sample?.timestamp) || Math.floor(Date.now() / 1000);
  let seconds = Number(intervalSeconds) || 5;
  if (lastObservedAtSec > 0) {
    seconds = Math.max(1, Math.min(60, nowSec - lastObservedAtSec));
  }
  lastObservedAtSec = nowSec;

  const appName = sample?.process?.appName || sample?.activeApp?.name || "Unknown";
  const windowTitle = sample?.process?.windowTitle || sample?.activeApp?.title || "";
  const category = semantic.classifyApp(appName, windowTitle);
  const isIdle = Boolean(sample?.idle?.isIdle);
  const cpu = Number(sample?.cpu?.usagePercent ?? sample?.cpuUsage) || 0;
  const ram = Number(sample?.ram?.usagePercent ?? sample?.ramUsage) || 0;
  const gpu = Number(sample?.gpu?.usagePercent ?? sample?.gpuUsage) || 0;

  if (state.currentApp && state.currentApp !== appName) state.switchCount += 1;
  if (state.currentApp !== appName) {
    if (!state.apps[appName]) {
      state.apps[appName] = { durationSeconds: 0, sessions: 0, cpuSum: 0, ramSum: 0, sampleCount: 0, category };
    }
    state.apps[appName].sessions = (state.apps[appName].sessions || 0) + 1;
    state.currentSessionStartedAt = nowSec;
  }

  state.currentApp = appName;
  state.currentCategory = category;
  state.totalOnlineSeconds += seconds;
  if (isIdle) state.totalIdleSeconds += seconds;
  else state.totalActiveSeconds += seconds;
  state.sampleCount += 1;
  state.cpuSum += cpu;
  state.ramSum += ram;
  state.gpuSum += gpu;
  if (cpu > state.cpuPeak) state.cpuPeak = cpu;
  if (ram > state.ramPeak) state.ramPeak = ram;
  if (gpu > state.gpuPeak) state.gpuPeak = gpu;
  state.lastSampleAt = nowSec;

  addAppSeconds(appName, category, seconds, cpu, ram);
  addCategorySeconds(category, seconds);
  addProductivitySeconds(category, seconds);
}

async function flushRealtimeSummary({ force = false } = {}) {
  const summary = buildSummary({ final: false });
  if (!summary) return false;
  const now = Date.now();
  if (!force && now - (state.lastRealtimeSummaryAt * 1000 || 0) < config.realtimeStatsSummaryMs) return false;
  await realtimePresenceStore.upsertStatsSummary(summary);
  state.lastRealtimeSummaryAt = Math.floor(now / 1000);
  persist();
  return true;
}

async function flushFirestoreSummary({ final = false, force = false } = {}) {
  const summary = buildSummary({ final });
  if (!summary || !localApiClient.isConfigured()) {
    log.warn("flushFirestoreSummary skipped: no summary or api not configured");
    return false;
  }
  const now = Date.now();
  if (!force && config.firestoreStatsSummaryMs <= 0) {
    log.debug("flushFirestoreSummary skipped: periodical write disabled (ms <= 0)");
    return false;
  }
  if (!force && now - (state.lastFirestoreSummaryAt * 1000 || 0) < config.firestoreStatsSummaryMs) {
    log.debug("flushFirestoreSummary skipped: throttle active");
    return false;
  }
  log.info("flushing stats summary to Firestore", { summaryId: summary.summaryId, final, userEmail: summary.userEmail });
  try {
    await localApiClient.writeStatsSummary({
      deviceId: summary.deviceId,
      binding: { companyId: summary.companyId, userId: summary.userId, email: summary.userEmail, displayName: summary.userName },
      summary,
    });
    log.info("stats summary flushed to Firestore successfully", { summaryId: summary.summaryId });
  } catch (err) {
    log.error("failed to flush stats summary to Firestore", { summaryId: summary.summaryId, err: err.message });
    throw err;
  }
  state.lastFirestoreSummaryAt = Math.floor(now / 1000);
  persist();
  return true;
}

function start() {
  if (initialized) return;
  state = loadState();
  initialized = true;

  checkpointTimer = setInterval(() => {
    try { persist(); } catch (err) { log.warn("stats checkpoint failed", { err: err.message }); }
  }, config.statsCheckpointMs);
  if (checkpointTimer.unref) checkpointTimer.unref();

  realtimeSummaryTimer = setInterval(() => {
    flushRealtimeSummary().catch((err) => log.warn("RTDB stats summary failed", { err: err.message }));
  }, Math.max(config.realtimeStatsSummaryMs, config.statsCheckpointMs));
  if (realtimeSummaryTimer.unref) realtimeSummaryTimer.unref();

  if (config.firestoreStatsSummaryMs > 0) {
    firestoreSummaryTimer = setInterval(() => {
      flushFirestoreSummary().catch((err) => log.warn("Firestore stats summary failed", { err: err.message }));
    }, config.firestoreStatsSummaryMs);
    if (firestoreSummaryTimer.unref) firestoreSummaryTimer.unref();
  }
}

async function stop({ flushFirestore = true } = {}) {
  if (checkpointTimer) clearInterval(checkpointTimer);
  if (realtimeSummaryTimer) clearInterval(realtimeSummaryTimer);
  if (firestoreSummaryTimer) clearInterval(firestoreSummaryTimer);
  checkpointTimer = null;
  realtimeSummaryTimer = null;
  firestoreSummaryTimer = null;

  try { persist(); } catch (err) { log.warn("final stats checkpoint failed", { err: err.message }); }
  try { await flushRealtimeSummary({ force: true }); } catch (err) { log.warn("final RTDB stats summary failed", { err: err.message }); }
  if (flushFirestore && config.firestoreStatsSummaryOnStop) {
    try { await flushFirestoreSummary({ final: true, force: true }); } catch (err) { log.warn("final Firestore stats summary failed", { err: err.message }); }
  }
  initialized = false;
}

function reset() {
  state = freshState();
  context = null;
  lastObservedAtSec = 0;
}

function markAnomaly() {
  state.anomalyCount += 1;
}

module.exports = {
  start,
  stop,
  reset,
  observe,
  markAnomaly,
  buildSummary,
  flushRealtimeSummary,
  flushFirestoreSummary,
};
