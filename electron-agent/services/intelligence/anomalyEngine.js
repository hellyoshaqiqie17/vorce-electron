"use strict";

/**
 * Anomaly engine.
 *
 * Detects locally and emits ONE event per anomaly to:
 *   companies/{companyId}/anomaly_events/{eventId}
 *
 * Rules (sustained, not spike-on-single-tick):
 *   - cpu_spike       : cpu >= 95% for 3 consecutive samples
 *   - ram_pressure    : ram >= 90% for 3 consecutive samples
 *   - excessive_switching : >= 30 app switches within 5 minutes
 *   - prolonged_idle  : idle continuously for >= 15 minutes
 *
 * Cooldown: same anomaly type cannot fire again within 5 minutes.
 */

const crypto = require("crypto");

const COOLDOWN_MS = 5 * 60 * 1000;
const SWITCH_WINDOW_MS = 5 * 60 * 1000;
const SWITCH_THRESHOLD = 30;
const IDLE_THRESHOLD_SEC = 15 * 60;
const SUSTAIN_TICKS = 3;

function makeId() {
  return crypto.randomBytes(10).toString("hex");
}

function createEngine({ writer, log }) {
  const lastFired = new Map(); // type -> timestampMs
  const switches = []; // [{ at: ms }]
  let cpuStreak = 0;
  let ramStreak = 0;
  let lastApp = null;

  async function fire(type, data, deviceId, binding) {
    const nowMs = Date.now();
    const last = lastFired.get(type) || 0;
    if (nowMs - last < COOLDOWN_MS) return;
    lastFired.set(type, nowMs);
    const event = {
      eventId: makeId(),
      type,
      severity: data.severity || "warn",
      deviceId,
      companyId: binding.companyId,
      userId: binding.userId,
      detectedAt: Math.floor(nowMs / 1000),
      ...data,
    };
    try {
      await writer(event);
    } catch (err) {
      log?.warn?.("anomaly write failed", { type, err: err.message });
    }
  }

  return {
    async observe({ deviceId, binding, sample }) {
      if (!binding?.companyId || !binding?.userId) return;
      const cpu = Number(sample?.cpu?.usagePercent ?? sample?.cpuUsage) || 0;
      const ram = Number(sample?.ram?.usagePercent ?? sample?.ramUsage) || 0;
      const idleSec = Number(sample?.idle?.idleSeconds) || 0;
      const isIdle = Boolean(sample?.idle?.isIdle);
      const appName = sample?.process?.appName || sample?.activeApp?.name || "";

      // CPU sustained spike
      if (cpu >= 95) cpuStreak += 1; else cpuStreak = 0;
      if (cpuStreak >= SUSTAIN_TICKS) {
        await fire("cpu_spike", { cpu, severity: "high", message: `CPU ${cpu.toFixed(1)}% sustained` }, deviceId, binding);
        cpuStreak = 0;
      }

      // RAM sustained pressure
      if (ram >= 90) ramStreak += 1; else ramStreak = 0;
      if (ramStreak >= SUSTAIN_TICKS) {
        await fire("ram_pressure", { ram, severity: "high", message: `RAM ${ram.toFixed(1)}% sustained` }, deviceId, binding);
        ramStreak = 0;
      }

      // Excessive switching: track app changes
      if (appName && appName !== lastApp) {
        if (lastApp !== null) {
          switches.push(Date.now());
          const cutoff = Date.now() - SWITCH_WINDOW_MS;
          while (switches.length && switches[0] < cutoff) switches.shift();
          if (switches.length >= SWITCH_THRESHOLD) {
            await fire("excessive_switching", {
              switches: switches.length,
              windowSeconds: SWITCH_WINDOW_MS / 1000,
              severity: "warn",
              message: `${switches.length} app switches in 5 min`,
            }, deviceId, binding);
            switches.length = 0;
          }
        }
        lastApp = appName;
      }

      // Prolonged idle
      if (isIdle && idleSec >= IDLE_THRESHOLD_SEC) {
        await fire("prolonged_idle", {
          idleSeconds: idleSec,
          severity: "info",
          message: `Idle for ${Math.round(idleSec / 60)} min`,
        }, deviceId, binding);
      }
    },

    reset() {
      lastFired.clear();
      switches.length = 0;
      cpuStreak = 0;
      ramStreak = 0;
      lastApp = null;
    },
  };
}

module.exports = { createEngine };
