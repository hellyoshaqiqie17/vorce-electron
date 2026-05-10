"use strict";

/**
 * Analytics snapshot engine.
 *
 * Aggregates locally and writes ONE compressed snapshot every WINDOW_MS to:
 *   companies/{companyId}/analytics_snapshots/{snapshotId}
 *
 * Snapshot contents:
 *   - cpuAverage / cpuPeak
 *   - ramAverage / ramPeak
 *   - dominantApps[] (top 5 by foreground duration)
 *   - dominantCategories[]
 *   - switchCount
 *   - activeRatio (1 - idleRatio)
 *   - sessionsCount (finalized within window)
 *   - anomalyCount
 *   - productivityScore (0..100)
 *   - fatigueLevel (low/medium/high)
 *   - behavior tag (from semanticAnalyzer)
 */

const crypto = require("crypto");
const semantic = require("./semanticAnalyzer");

const WINDOW_MS = 20 * 60 * 1000; // 20 minutes
const TICK_MS = 60 * 1000; // try flush every minute

function makeId() {
  return crypto.randomBytes(10).toString("hex");
}

function createEngine({ writer, log, now = () => Date.now() }) {
  let bucket = freshBucket(now());
  let timer = null;
  let bindingRef = null;
  let deviceIdRef = null;

  function freshBucket(startMs) {
    return {
      windowStart: startMs,
      cpuValues: [],
      ramValues: [],
      idleSamples: 0,
      sampleCount: 0,
      switchCount: 0,
      anomalyCount: 0,
      sessionsCount: 0,
      longestFocusSeconds: 0,
      appDurations: new Map(), // app -> seconds (approx via sample interval)
      categoryDurations: new Map(),
      lastApp: null,
    };
  }

  function summarize() {
    const sampleCount = bucket.sampleCount;
    if (sampleCount === 0) return null;
    const cpuAvg = avg(bucket.cpuValues);
    const cpuPeak = Math.max(0, ...bucket.cpuValues);
    const ramAvg = avg(bucket.ramValues);
    const ramPeak = Math.max(0, ...bucket.ramValues);
    const idleRatio = sampleCount > 0 ? bucket.idleSamples / sampleCount : 0;
    const activeRatio = 1 - idleRatio;

    const dominantApps = topN(bucket.appDurations, 5);
    const dominantCategories = topN(bucket.categoryDurations, 5);

    const productivityScore = computeProductivity(dominantCategories, activeRatio);
    const fatigueLevel = computeFatigue({ activeRatio, ramAvg, cpuPeak, switchCount: bucket.switchCount });
    const behavior = semantic.classifyBehavior({
      cpuAvg,
      cpuPeak,
      ramAvg,
      switches: bucket.switchCount,
      idleRatio,
      longestFocusSeconds: bucket.longestFocusSeconds,
      sessionsCount: bucket.sessionsCount,
    });

    return {
      snapshotId: makeId(),
      windowStart: Math.floor(bucket.windowStart / 1000),
      windowEnd: Math.floor(now() / 1000),
      windowSeconds: Math.round((now() - bucket.windowStart) / 1000),
      cpuAverage: round1(cpuAvg),
      cpuPeak: round1(cpuPeak),
      ramAverage: round1(ramAvg),
      ramPeak: round1(ramPeak),
      switchCount: bucket.switchCount,
      activeRatio: round2(activeRatio),
      idleRatio: round2(idleRatio),
      sessionsCount: bucket.sessionsCount,
      anomalyCount: bucket.anomalyCount,
      dominantApps,
      dominantCategories,
      productivityScore,
      fatigueLevel,
      behavior,
    };
  }

  async function flush() {
    if (!bindingRef || !deviceIdRef) return;
    if (now() - bucket.windowStart < WINDOW_MS) return;
    if (bucket.sampleCount === 0) {
      bucket = freshBucket(now());
      return;
    }
    const summary = summarize();
    if (!summary) {
      bucket = freshBucket(now());
      return;
    }
    const payload = {
      ...summary,
      deviceId: deviceIdRef,
      companyId: bindingRef.companyId,
      userId: bindingRef.userId,
    };
    try {
      await writer(payload);
    } catch (err) {
      log?.warn?.("snapshot write failed", { err: err.message });
    }
    bucket = freshBucket(now());
  }

  return {
    start({ deviceId, binding }) {
      bindingRef = binding;
      deviceIdRef = deviceId;
      if (timer) return;
      timer = setInterval(() => { flush().catch(() => {}); }, TICK_MS);
      if (timer.unref) timer.unref();
    },

    observe({ sample, intervalSeconds = 5 }) {
      if (!bindingRef) return;
      const cpu = Number(sample?.cpu?.usagePercent ?? sample?.cpuUsage) || 0;
      const ram = Number(sample?.ram?.usagePercent ?? sample?.ramUsage) || 0;
      const isIdle = Boolean(sample?.idle?.isIdle);
      const app = sample?.process?.appName || "Unknown";
      const category = semantic.classifyApp(app, sample?.process?.windowTitle);
      bucket.cpuValues.push(cpu);
      bucket.ramValues.push(ram);
      if (isIdle) bucket.idleSamples += 1;
      bucket.sampleCount += 1;
      addDuration(bucket.appDurations, app, intervalSeconds);
      addDuration(bucket.categoryDurations, category, intervalSeconds);
      if (bucket.lastApp && bucket.lastApp !== app) bucket.switchCount += 1;
      bucket.lastApp = app;
    },

    onSessionFinalized(sessionPayload) {
      bucket.sessionsCount += 1;
      const dur = Number(sessionPayload?.durationSeconds) || 0;
      if (dur > bucket.longestFocusSeconds) bucket.longestFocusSeconds = dur;
    },

    onAnomaly() {
      bucket.anomalyCount += 1;
    },

    /** Force-flush ignoring window boundary, for graceful shutdown. */
    async flushNow() {
      if (!bindingRef || bucket.sampleCount === 0) return;
      const summary = summarize();
      if (!summary) return;
      const payload = { ...summary, deviceId: deviceIdRef, companyId: bindingRef.companyId, userId: bindingRef.userId };
      try { await writer(payload); } catch (err) { log?.warn?.("snapshot flushNow failed", { err: err.message }); }
      bucket = freshBucket(now());
    },

    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },

    reset() {
      bucket = freshBucket(now());
    },
  };
}

function avg(arr) {
  if (!arr.length) return 0;
  let sum = 0; for (const v of arr) sum += v;
  return sum / arr.length;
}
function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }
function addDuration(map, key, seconds) {
  map.set(key, (map.get(key) || 0) + seconds);
}
function topN(map, n) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, seconds]) => ({ name, seconds: Math.round(seconds) }));
}
function computeProductivity(dominantCategories, activeRatio) {
  let weighted = 0;
  let total = 0;
  for (const c of dominantCategories) {
    const w = semantic.productivityScoreFor(c.name);
    weighted += w * c.seconds;
    total += c.seconds;
  }
  const base = total > 0 ? (weighted / total) : 0.4;
  return Math.round(base * activeRatio * 100);
}
function computeFatigue({ activeRatio, ramAvg, cpuPeak, switchCount }) {
  let score = 0;
  if (ramAvg >= 85) score += 2;
  else if (ramAvg >= 70) score += 1;
  if (cpuPeak >= 95) score += 2;
  else if (cpuPeak >= 80) score += 1;
  if (switchCount >= 30) score += 2;
  else if (switchCount >= 15) score += 1;
  if (activeRatio < 0.4) score += 1;
  if (score >= 4) return "high";
  if (score >= 2) return "medium";
  return "low";
}

module.exports = { createEngine };
