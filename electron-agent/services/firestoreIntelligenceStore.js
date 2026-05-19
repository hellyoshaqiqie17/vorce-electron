"use strict";

/**
 * Intelligence Firestore store.
 *
 * Writes to the new compressed-intelligence collections:
 *   companies/{companyId}/live_presence/{deviceId}      (overwrite)
 *   companies/{companyId}/device_sessions/{sessionId}   (one write per finalized session)
 *   companies/{companyId}/analytics_snapshots/{snapshotId}  (~ every 20 min)
 *   companies/{companyId}/anomaly_events/{eventId}      (event only)
 *   companies/{companyId}/activity_timeline/{entryId}   (compact recent activity feed)
 *   companies/{companyId}/employee_behavior/{userId}    (rolling behavior profile)
 */

const {
  doc,
  collection,
  setDoc,
  serverTimestamp,
  Timestamp,
  increment,
} = require("firebase/firestore");
const firebaseClient = require("../firebase/firebaseClient");
const { make } = require("../utils/logger");

const log = make("firestoreIntelligenceStore");

function db() {
  return firebaseClient.getDb();
}
function need(name, value) {
  if (!value) throw new Error(`${name} belum tersedia.`);
}
function tsFromSeconds(sec) {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Timestamp.fromMillis(n * 1000);
}

async function upsertPresence(payload) {
  need("companyId", payload.companyId);
  need("deviceId", payload.deviceId);
  const ref = doc(db(), "companies", payload.companyId, "live_presence", payload.deviceId);
  const data = {
    ...payload,
    sessionStartedAt: tsFromSeconds(payload.sessionStartedAt),
    lastHeartbeat: tsFromSeconds(payload.lastHeartbeat) || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, data, { merge: true });
  log.debug("presence overwritten", { deviceId: payload.deviceId, app: payload.currentApp });
}

async function writeFinalizedSession(payload) {
  need("companyId", payload.companyId);
  need("sessionId", payload.sessionId);
  const ref = doc(db(), "companies", payload.companyId, "device_sessions", payload.sessionId);
  const data = {
    ...payload,
    startedAt: tsFromSeconds(payload.startedAt),
    endedAt: tsFromSeconds(payload.endedAt),
    createdAt: serverTimestamp(),
  };
  await setDoc(ref, data, { merge: true });

  // Compact timeline feed (capped client-side via TTL/external trim later)
  const timelineRef = doc(collection(db(), "companies", payload.companyId, "activity_timeline"), payload.sessionId);
  await setDoc(timelineRef, {
    sessionId: payload.sessionId,
    deviceId: payload.deviceId,
    userId: payload.userId,
    app: payload.app,
    category: payload.category,
    startedAt: tsFromSeconds(payload.startedAt),
    endedAt: tsFromSeconds(payload.endedAt),
    durationSeconds: payload.durationSeconds,
    productivityType: payload.productivityType,
    focusScore: payload.focusScore,
    createdAt: serverTimestamp(),
  }, { merge: true });

  // Behavior aggregation per user (rolling)
  if (payload.userId) {
    const behaviorRef = doc(db(), "companies", payload.companyId, "employee_behavior", payload.userId);
    await setDoc(behaviorRef, {
      userId: payload.userId,
      companyId: payload.companyId,
      lastSessionId: payload.sessionId,
      lastSessionAt: tsFromSeconds(payload.endedAt) || serverTimestamp(),
      totalSessions: increment(1),
      totalActiveSeconds: increment(payload.durationSeconds || 0),
      lastFocusScore: payload.focusScore || 0,
      lastCategory: payload.category || "",
      lastApp: payload.app || "",
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  log.debug("session finalized", { sessionId: payload.sessionId, app: payload.app, dur: payload.durationSeconds });
}

async function writeSnapshot(payload) {
  need("companyId", payload.companyId);
  need("snapshotId", payload.snapshotId);
  const ref = doc(db(), "companies", payload.companyId, "analytics_snapshots", payload.snapshotId);
  await setDoc(ref, {
    ...payload,
    windowStart: tsFromSeconds(payload.windowStart),
    windowEnd: tsFromSeconds(payload.windowEnd),
    createdAt: serverTimestamp(),
  }, { merge: true });
  log.debug("snapshot written", { snapshotId: payload.snapshotId, productivity: payload.productivityScore });
}

async function writeAnomaly(payload) {
  need("companyId", payload.companyId);
  need("eventId", payload.eventId);
  const ref = doc(db(), "companies", payload.companyId, "anomaly_events", payload.eventId);
  await setDoc(ref, {
    ...payload,
    detectedAt: tsFromSeconds(payload.detectedAt) || serverTimestamp(),
    createdAt: serverTimestamp(),
  }, { merge: true });
  log.debug("anomaly written", { type: payload.type, severity: payload.severity });
}

function tsFromSecondsOrNow(sec) {
  return tsFromSeconds(sec) || serverTimestamp();
}

async function writeStatsSummary(payload) {
  need("companyId", payload.companyId);
  need("summaryId", payload.summaryId);
  const ref = doc(db(), "companies", payload.companyId, "stats_summaries", payload.summaryId);
  await setDoc(ref, {
    ...payload,
    startedAt: tsFromSecondsOrNow(payload.startedAt),
    lastSampleAt: tsFromSeconds(payload.lastSampleAt),
    generatedAt: tsFromSecondsOrNow(payload.generatedAt),
    updatedAt: serverTimestamp(),
  }, { merge: true });
  log.debug("stats summary written", { summaryId: payload.summaryId, final: payload.final });
}

// ---- Aggregation writers (increment-based, no reads) -----------------------

/**
 * Recursively rewrite numeric leaves into Firestore `increment(value)`.
 * Strings, timestamps, and nested objects are preserved as-is.
 * Arrays are not used here on purpose; aggregates are maps of counters.
 */
function toIncrementTree(node) {
  if (node === null || node === undefined) return node;
  if (typeof node === "number" && Number.isFinite(node)) return increment(node);
  if (typeof node !== "object") return node;
  if (Array.isArray(node)) return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    out[k] = toIncrementTree(v);
  }
  return out;
}

async function incrementAggregate({ collectionName, payload }) {
  need("companyId", payload.companyId);
  need("userId", payload.userId);
  need("docId", payload.docId);
  const ref = doc(db(), "companies", payload.companyId, collectionName, payload.docId);

  const { docId, companyId, userId, counters, categories, appUsage, productivityDistribution, dailyTrend, weeklyTrend, lastSessionId, ...identity } = payload;

  const data = {
    // identity (set once, merged forever)
    userId,
    companyId,
    ...identity,
    lastSessionId: lastSessionId || null,
    updatedAt: serverTimestamp(),
    generatedAt: serverTimestamp(),
    // numeric counters → increment()
    counters: counters ? toIncrementTree(counters) : undefined,
    categories: categories ? toIncrementTree(categories) : undefined,
    appUsage: appUsage ? toIncrementTree(appUsage) : undefined,
    productivityDistribution: productivityDistribution ? toIncrementTree(productivityDistribution) : undefined,
    dailyTrend: dailyTrend ? toIncrementTree(dailyTrend) : undefined,
    weeklyTrend: weeklyTrend ? toIncrementTree(weeklyTrend) : undefined,
  };

  // Strip undefined keys so Firestore doesn't reject them.
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];

  await setDoc(ref, data, { merge: true });
  log.debug("aggregate incremented", { collectionName, docId: payload.docId });
}

async function incrementDailyAnalytics(payload) {
  return incrementAggregate({ collectionName: "employee_behavior_daily", payload });
}

async function incrementWeeklyAnalytics(payload) {
  return incrementAggregate({ collectionName: "employee_behavior_weekly", payload });
}

async function incrementMonthlyAnalytics(payload) {
  return incrementAggregate({ collectionName: "employee_behavior_monthly", payload });
}

module.exports = {
  upsertPresence,
  writeFinalizedSession,
  writeSnapshot,
  writeAnomaly,
  writeStatsSummary,
  incrementDailyAnalytics,
  incrementWeeklyAnalytics,
  incrementMonthlyAnalytics,
};
