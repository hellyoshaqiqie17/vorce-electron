"use strict";

/**
 * Realtime presence engine.
 *
 * Maintains a single OVERWRITTEN document at:
 *   companies/{companyId}/live_presence/{deviceId}
 *
 * Write rules (whichever first):
 *   - app changed
 *   - state changed (online/idle/offline)
 *   - significant CPU/RAM delta (>= 10%)
 *   - 20 seconds since last write (heartbeat)
 *
 * Never appends. Never spams. Cheap by design.
 */

const semantic = require("./semanticAnalyzer");

const HEARTBEAT_MS = 20 * 1000;
const CPU_DELTA = 10;
const RAM_DELTA = 10;

function deriveState(sample) {
  if (sample?.idle?.isIdle) return "idle";
  return "online";
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function computeHealthScore(sample) {
  const cpu = Number(sample?.cpu?.usagePercent ?? sample?.cpuUsage) || 0;
  const ram = Number(sample?.ram?.usagePercent ?? sample?.ramUsage) || 0;
  const storage = Number(sample?.storage?.usagePercent) || 0;
  const cpuPenalty = clamp(cpu - 70, 0, 30);
  const ramPenalty = clamp(ram - 70, 0, 30);
  const storagePenalty = clamp(storage - 80, 0, 20) * 0.5;
  return Math.round(clamp(100 - cpuPenalty - ramPenalty - storagePenalty, 0, 100));
}

function buildPayload({ deviceId, binding, sample, sessionStartedAt, sessionId }) {
  const proc = sample?.process || {};
  const appName = proc.appName || "Unknown";
  const category = semantic.classifyApp(appName, proc.windowTitle);
  return {
    deviceId,
    companyId: binding.companyId,
    userId: binding.userId,
    userEmail: binding.email || "",
    userName: binding.displayName || "",
    currentApp: appName,
    currentCategory: category,
    activeWindow: proc.windowTitle || "",
    executable: proc.executable || "",
    cpuNow: Math.round((Number(sample?.cpu?.usagePercent ?? sample?.cpuUsage) || 0) * 10) / 10,
    ramNow: Math.round((Number(sample?.ram?.usagePercent ?? sample?.ramUsage) || 0) * 10) / 10,
    state: deriveState(sample),
    healthScore: computeHealthScore(sample),
    sessionId: sessionId || null,
    sessionStartedAt: sessionStartedAt || null,
    lastHeartbeat: Math.floor(Date.now() / 1000),
  };
}

function createEngine({ writer, log }) {
  let lastPayload = null;
  let lastWriteAt = 0;
  let inFlight = false;

  function shouldWrite(prev, next, nowMs) {
    if (!prev) return true;
    if (nowMs - lastWriteAt >= HEARTBEAT_MS) return true;
    if (prev.currentApp !== next.currentApp) return true;
    if (prev.state !== next.state) return true;
    if (prev.sessionId !== next.sessionId) return true;
    if (Math.abs(next.cpuNow - prev.cpuNow) >= CPU_DELTA) return true;
    if (Math.abs(next.ramNow - prev.ramNow) >= RAM_DELTA) return true;
    return false;
  }

  return {
    async observe({ deviceId, binding, sample, activeSession }) {
      if (!binding?.companyId || !binding?.userId) return;
      const next = buildPayload({
        deviceId,
        binding,
        sample,
        sessionStartedAt: activeSession?.startedAt,
        sessionId: activeSession?.sessionId,
      });
      const now = Date.now();
      if (!shouldWrite(lastPayload, next, now)) return;
      if (inFlight) return; // drop if previous still pending
      inFlight = true;
      try {
        await writer(next);
        lastPayload = next;
        lastWriteAt = now;
      } catch (err) {
        log?.warn?.("presence write failed", { err: err.message });
      } finally {
        inFlight = false;
      }
    },

    async markOffline({ deviceId, binding }) {
      if (!binding?.companyId || !binding?.userId) return;
      try {
        await writer({
          deviceId,
          companyId: binding.companyId,
          userId: binding.userId,
          state: "offline",
          lastHeartbeat: Math.floor(Date.now() / 1000),
        });
      } catch (err) {
        log?.warn?.("presence offline write failed", { err: err.message });
      }
      lastPayload = null;
      lastWriteAt = 0;
    },

    reset() {
      lastPayload = null;
      lastWriteAt = 0;
      inFlight = false;
    },
  };
}

module.exports = { createEngine };
