"use strict";

/**
 * Local sessionization engine.
 *
 * - Maintains the active session in memory only.
 * - Buffers cpu/ram samples, switch counts, idle proportion locally.
 * - Writes ONE finalized document to companies/{companyId}/device_sessions/{sessionId}
 *   when the session ends (app switch, idle timeout, lock, shutdown).
 *
 * No periodic upserts. No realtime spam.
 */

const crypto = require("crypto");
const semantic = require("./semanticAnalyzer");

const MIN_SESSION_SECONDS = 3;
const IDLE_END_SECONDS = 90; // idle > 90s ends the session

function clean(value) {
  return String(value || "").trim();
}

function sessionKey(processInfo) {
  const appName = clean(processInfo.appName).toLowerCase();
  const winTitle = clean(processInfo.windowTitle).toLowerCase();
  const exe = clean(processInfo.executable).toLowerCase();
  const isBrowser = /chrome|firefox|edge|brave|opera|safari|vivaldi|arc/.test(appName) ||
    /chrome|firefox|edge|brave|opera|safari|vivaldi|arc/.test(exe);
  if (isBrowser) return `browser|${appName}|${winTitle}`;
  return `app|${appName}`;
}

function makeSessionId(deviceId, key, startedAtMs) {
  return crypto.createHash("sha1")
    .update(`${deviceId}|${key}|${startedAtMs}`)
    .digest("hex")
    .slice(0, 24);
}

function createEngine({ writer, log }) {
  let current = null;

  function newSession({ deviceId, binding, processInfo, key, nowSec, sample }) {
    const startedAtMs = nowSec * 1000;
    return {
      sessionId: makeSessionId(deviceId, key, startedAtMs),
      deviceId,
      binding,
      key,
      app: processInfo.appName || "Unknown",
      executable: processInfo.executable || "",
      windowTitle: processInfo.windowTitle || "",
      pid: Number(processInfo.pid) || 0,
      category: semantic.classifyApp(processInfo.appName, processInfo.windowTitle),
      startedAt: nowSec,
      lastSeenAt: nowSec,
      switchCount: 0,
      cpuSum: Number(sample?.cpuUsage) || 0,
      ramSum: Number(sample?.ramUsage) || 0,
      cpuPeak: Number(sample?.cpuUsage) || 0,
      ramPeak: Number(sample?.ramUsage) || 0,
      sampleCount: 1,
      idleSamples: sample?.idle?.isIdle ? 1 : 0,
      anomalyDetected: false,
    };
  }

  function buildPayload(session, endedAtSec) {
    const duration = Math.max(0, endedAtSec - session.startedAt);
    const cpuAverage = session.sampleCount > 0 ? session.cpuSum / session.sampleCount : 0;
    const ramAverage = session.sampleCount > 0 ? session.ramSum / session.sampleCount : 0;
    const idleRatio = session.sampleCount > 0 ? session.idleSamples / session.sampleCount : 0;
    const focusScore = semantic.computeFocusScore({
      durationSeconds: duration,
      switchCount: session.switchCount,
      category: session.category,
      idleRatio,
    });
    const productivityType = semantic.classifyProductivityType(
      session.category,
      duration,
      session.switchCount
    );
    return {
      sessionId: session.sessionId,
      companyId: session.binding.companyId,
      userId: session.binding.userId,
      deviceId: session.deviceId,
      app: session.app,
      category: session.category,
      executable: session.executable,
      windowTitle: session.windowTitle,
      startedAt: session.startedAt,
      endedAt: endedAtSec,
      durationSeconds: duration,
      switchCount: session.switchCount,
      cpuAverage: Math.round(cpuAverage * 10) / 10,
      cpuPeak: Math.round(session.cpuPeak * 10) / 10,
      ramAverage: Math.round(ramAverage * 10) / 10,
      ramPeak: Math.round(session.ramPeak * 10) / 10,
      idleRatio: Math.round(idleRatio * 100) / 100,
      focusScore,
      productivityType,
      anomalyDetected: Boolean(session.anomalyDetected),
    };
  }

  async function finalize(session, endedAtSec) {
    const duration = endedAtSec - session.startedAt;
    if (duration < MIN_SESSION_SECONDS) return null;
    const payload = buildPayload(session, endedAtSec);
    try {
      await writer(payload);
    } catch (err) {
      log?.warn?.("session finalize write failed", { err: err.message });
    }
    return payload;
  }

  return {
    /** Returns finalized session payload (or null) if a session ended on this sample. */
    async observe({ deviceId, binding, sample }) {
      const processInfo = sample?.process || {};
      const appName = clean(processInfo.appName);
      if (!appName || appName === "Unknown") return null;

      const nowSec = Number(sample?.timestamp) || Math.floor(Date.now() / 1000);
      const isIdle = Boolean(sample?.idle?.isIdle);
      const key = sessionKey(processInfo);

      // Idle for too long → close current session
      if (current && isIdle && (nowSec - current.lastSeenAt) >= IDLE_END_SECONDS) {
        const finalized = await finalize(current, current.lastSeenAt);
        current = null;
        return finalized;
      }

      if (!current) {
        current = newSession({ deviceId, binding, processInfo, key, nowSec, sample });
        return null;
      }

      if (current.key !== key) {
        const finalized = await finalize(current, nowSec);
        current = newSession({ deviceId, binding, processInfo, key, nowSec, sample });
        if (finalized) current.switchCount = 0;
        return finalized;
      }

      // Same session: aggregate
      current.lastSeenAt = nowSec;
      const cpu = Number(sample?.cpuUsage) || 0;
      const ram = Number(sample?.ramUsage) || 0;
      current.cpuSum += cpu;
      current.ramSum += ram;
      current.sampleCount += 1;
      if (cpu > current.cpuPeak) current.cpuPeak = cpu;
      if (ram > current.ramPeak) current.ramPeak = ram;
      if (isIdle) current.idleSamples += 1;
      // Window-level switch counter increments per micro-switch (sub-tab/title change inside same session)
      const titleChanged = clean(processInfo.windowTitle) !== current.windowTitle;
      if (titleChanged) {
        current.switchCount += 1;
        current.windowTitle = clean(processInfo.windowTitle);
      }
      return null;
    },

    markAnomaly() {
      if (current) current.anomalyDetected = true;
    },

    getActive() {
      return current
        ? {
            sessionId: current.sessionId,
            app: current.app,
            category: current.category,
            startedAt: current.startedAt,
            switchCount: current.switchCount,
          }
        : null;
    },

    /** Force-finalize the current session (graceful shutdown). */
    async flush() {
      if (!current) return null;
      const endedAt = Math.floor(Date.now() / 1000);
      const finalized = await finalize(current, endedAt);
      current = null;
      return finalized;
    },

    reset() {
      current = null;
    },
  };
}

module.exports = { createEngine };
