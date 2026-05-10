"use strict";

/**
 * Aggregation Engine.
 *
 * Triggered on every finalized device_session.
 * For each finalized session, atomically updates THREE aggregate documents
 * via Firestore field increments (no reads, no scans):
 *
 *   companies/{companyId}/employee_behavior_daily/{userId_YYYYMMDD}
 *   companies/{companyId}/employee_behavior_weekly/{userId_YYYY_WW}
 *   companies/{companyId}/employee_behavior_monthly/{userId_YYYY_MM}
 *
 * IMPORTANT principles:
 *   - DO NOT read raw sessions when the dashboard opens.
 *   - DO NOT recompute weekly/monthly from raw sessions; increment them
 *     on the same write path as daily.
 *   - All counters compose under increment(): totals, switch counts,
 *     anomaly counts, per-category seconds, per-app seconds, productivity
 *     distribution, weighted-sum for derived averages.
 *
 * Derived metrics (productivityScore, fatigueScore, dominantCategory, etc.)
 * are NOT stored as scalars; they are computed at read-time by the
 * dashboard from the raw counters embedded in the doc. This keeps writes
 * one-shot and read-cheap.
 */

const semantic = require("./semanticAnalyzer");

const CATEGORY_MAP = {
  Productivity: "productivity",
  Communication: "communication",
  Browsing: "browser",
  Entertainment: "entertainment",
  System: "system",
  Application: "other",
};

// Code/IDE-specific apps get a finer "development" bucket.
const DEV_PATTERN = /(code|studio|windsurf|cursor|intellij|webstorm|pycharm|rider|sublime|vim|neovim|atom|electron)/i;

function categoryKey(category, app) {
  if (DEV_PATTERN.test(app || "")) return "development";
  return CATEGORY_MAP[category] || "other";
}

function sanitizeKey(raw) {
  // Firestore map keys can't contain '.', '~', '*', '/', '[', ']' reliably.
  // Replace any non-safe char with '_'.
  return String(raw || "unknown")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "unknown";
}

function pad2(n) { return String(n).padStart(2, "0"); }

/**
 * ISO week number (1..53) for a given UTC date.
 * Returns { isoYear, isoWeek }.
 */
function isoWeekParts(d) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // nearest Thursday
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);
  const week = 1 + Math.round((date - firstThursday) / (7 * 24 * 3600 * 1000));
  return { isoYear: date.getUTCFullYear(), isoWeek: week };
}

function periodKeysFor(dateInput) {
  const d = new Date(dateInput);
  const yyyy = d.getUTCFullYear();
  const mm = pad2(d.getUTCMonth() + 1);
  const dd = pad2(d.getUTCDate());
  const { isoYear, isoWeek } = isoWeekParts(d);
  return {
    dayKey: `${yyyy}${mm}${dd}`,
    weekKey: `${isoYear}_W${pad2(isoWeek)}`,
    monthKey: `${yyyy}_${mm}`,
    year: yyyy,
    month: Number(mm),
    day: Number(dd),
    isoYear,
    isoWeek,
  };
}

/**
 * Build the increment payload for a finalized session.
 *
 * Returns three objects:
 *   { daily, weekly, monthly }
 * Each is the *delta* document to be merged with Firestore field increments.
 */
function buildDeltas(session) {
  const startedAtMs = (Number(session.startedAt) || 0) * 1000 || Date.now();
  const periods = periodKeysFor(startedAtMs);

  const duration = Math.max(0, Number(session.durationSeconds) || 0);
  const switchCount = Math.max(0, Number(session.switchCount) || 0);
  const anomaly = session.anomalyDetected ? 1 : 0;
  const focusScore = Math.max(0, Number(session.focusScore) || 0);
  const productivityType = String(session.productivityType || "general");
  const idleSec = Math.round((Number(session.idleRatio) || 0) * duration);
  const activeSec = Math.max(0, duration - idleSec);

  const catKey = categoryKey(session.category, session.app);
  const appKey = sanitizeKey(session.app);
  const productivityKey = sanitizeKey(productivityType);

  // Productive vs fragmented buckets (seconds).
  const focusedTypes = new Set(["deep_focus", "focused", "collaboration"]);
  const fragmentedTypes = new Set(["fragmented", "leisure"]);
  const focusedWorkSeconds = focusedTypes.has(productivityType) ? duration : 0;
  const fragmentedWorkSeconds = fragmentedTypes.has(productivityType) ? duration : 0;

  // Weighted sums to derive averages later (no extra reads needed).
  // productivity weight = focusScore (0..100)
  // fatigue weight     = derived from cpu/ram/switch density per session
  const fatigueScore = computeSessionFatigue(session);
  const healthScore = computeSessionHealth(session);

  // Common counters shared by daily/weekly/monthly.
  const counters = {
    sessionCount: 1,
    totalSeconds: duration,
    totalActiveSeconds: activeSec,
    totalIdleSeconds: idleSec,
    switchCount,
    anomalyCount: anomaly,
    focusedWorkSeconds,
    fragmentedWorkSeconds,
    productivityWeightedSum: focusScore * duration,
    productivityTotalSeconds: duration,
    fatigueWeightedSum: fatigueScore * duration,
    healthWeightedSum: healthScore * duration,
  };

  const categoryMap = { [catKey]: duration };
  const appMap = { [appKey]: duration };
  const productivityDistribution = { [productivityKey]: duration };

  return {
    periods,
    counters,
    categoryMap,
    appMap,
    productivityDistribution,
    catKey,
    appKey,
    productivityType,
    duration,
  };
}

function computeSessionFatigue(s) {
  // Higher = more fatiguing. 0..100.
  const ramAvg = Number(s.ramAverage) || 0;
  const cpuPeak = Number(s.cpuPeak) || 0;
  const switches = Number(s.switchCount) || 0;
  let score = 0;
  score += Math.max(0, ramAvg - 60) * 0.6;       // RAM stress
  score += Math.max(0, cpuPeak - 70) * 0.5;      // CPU peak stress
  score += Math.min(40, switches * 1.5);         // switching stress
  return Math.round(Math.max(0, Math.min(100, score)));
}

function computeSessionHealth(s) {
  // 100 - penalties. 0..100.
  const ramAvg = Number(s.ramAverage) || 0;
  const cpuAvg = Number(s.cpuAverage) || 0;
  let score = 100;
  if (ramAvg >= 70) score -= (ramAvg - 70);
  if (cpuAvg >= 70) score -= (cpuAvg - 70);
  if (s.anomalyDetected) score -= 10;
  return Math.round(Math.max(0, Math.min(100, score)));
}

/**
 * Build the *day-bucket* delta inside a weekly doc.
 * Weekly documents accumulate counters per day inside `dailyTrend` so the
 * dashboard can render a 7-bar chart from one read.
 */
function dailyTrendDelta(deltas) {
  return {
    [deltas.periods.dayKey]: {
      sessionCount: deltas.counters.sessionCount,
      totalSeconds: deltas.counters.totalSeconds,
      totalActiveSeconds: deltas.counters.totalActiveSeconds,
      productivityWeightedSum: deltas.counters.productivityWeightedSum,
      productivityTotalSeconds: deltas.counters.productivityTotalSeconds,
    },
  };
}

function weeklyTrendDelta(deltas) {
  return {
    [deltas.periods.weekKey]: {
      sessionCount: deltas.counters.sessionCount,
      totalSeconds: deltas.counters.totalSeconds,
      productivityWeightedSum: deltas.counters.productivityWeightedSum,
      productivityTotalSeconds: deltas.counters.productivityTotalSeconds,
    },
  };
}

/**
 * Public: create the aggregation engine.
 *
 * `writers` is the I/O surface: 3 functions, one per period. Each one
 * receives the merged-delta payload and is expected to perform a Firestore
 * `setDoc(..., { merge: true })` with `increment()` for every numeric leaf.
 */
function createEngine({ writers, log }) {
  if (!writers?.daily || !writers?.weekly || !writers?.monthly) {
    throw new Error("aggregationEngine: writers.daily/weekly/monthly required");
  }

  return {
    async onSessionFinalized(session) {
      if (!session?.companyId || !session?.userId || !session?.sessionId) return;
      const duration = Math.max(0, Number(session.durationSeconds) || 0);
      if (duration < 1) return; // ignore noise

      const deltas = buildDeltas(session);
      const baseId = session.userId;

      const dailyId = `${baseId}_${deltas.periods.dayKey}`;
      const weeklyId = `${baseId}_${deltas.periods.weekKey}`;
      const monthlyId = `${baseId}_${deltas.periods.monthKey}`;

      const sharedIdentity = {
        userId: session.userId,
        companyId: session.companyId,
      };

      const dailyPayload = {
        docId: dailyId,
        ...sharedIdentity,
        date: deltas.periods.dayKey,
        year: deltas.periods.year,
        month: deltas.periods.month,
        day: deltas.periods.day,
        counters: deltas.counters,
        categories: deltas.categoryMap,
        appUsage: deltas.appMap,
        productivityDistribution: deltas.productivityDistribution,
        lastSessionId: session.sessionId,
      };

      const weeklyPayload = {
        docId: weeklyId,
        ...sharedIdentity,
        week: deltas.periods.isoWeek,
        year: deltas.periods.isoYear,
        weekKey: deltas.periods.weekKey,
        counters: deltas.counters,
        categories: deltas.categoryMap,
        appUsage: deltas.appMap,
        productivityDistribution: deltas.productivityDistribution,
        dailyTrend: dailyTrendDelta(deltas),
        lastSessionId: session.sessionId,
      };

      const monthlyPayload = {
        docId: monthlyId,
        ...sharedIdentity,
        month: deltas.periods.month,
        year: deltas.periods.year,
        monthKey: deltas.periods.monthKey,
        counters: deltas.counters,
        categories: deltas.categoryMap,
        appUsage: deltas.appMap,
        productivityDistribution: deltas.productivityDistribution,
        weeklyTrend: weeklyTrendDelta(deltas),
        lastSessionId: session.sessionId,
      };

      // Three independent writes, all increments. If one fails, the others
      // can still succeed; aggregation remains converged because each
      // session is only ever processed once.
      const tasks = [
        writers.daily(dailyPayload).catch((err) => log?.warn?.("daily aggregate write failed", { err: err.message })),
        writers.weekly(weeklyPayload).catch((err) => log?.warn?.("weekly aggregate write failed", { err: err.message })),
        writers.monthly(monthlyPayload).catch((err) => log?.warn?.("monthly aggregate write failed", { err: err.message })),
      ];
      await Promise.all(tasks);
    },
  };
}

module.exports = {
  createEngine,
  // exported for tests and manual diagnostics
  buildDeltas,
  periodKeysFor,
  isoWeekParts,
  categoryKey,
  sanitizeKey,
};
