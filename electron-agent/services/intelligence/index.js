"use strict";

/**
 * Intelligence orchestrator.
 *
 * Single entrypoint that fans a single sample out to every local engine:
 *   sessionEngine    → finalize-on-end session writes
 *   presenceEngine   → debounced live_presence overwrites
 *   anomalyEngine    → event-only writes
 *   snapshotEngine   → ~20 min compressed analytics rollups
 *
 * Replaces the legacy metricsService + activitySessionService write paths.
 */

const sessionEngineMod = require("./sessionEngine");
const presenceEngineMod = require("./presenceEngine");
const anomalyEngineMod = require("./anomalyEngine");
const snapshotEngineMod = require("./snapshotEngine");
const aggregationEngineMod = require("./aggregationEngine");
const localApiClient = require("../localApiClient");
const realtimePresenceStore = require("../realtimePresenceStore");
const statsBatchBuffer = require("../statsBatchBuffer");
const config = require("../../core/config");
const { make } = require("../../utils/logger");

const log = make("intelligence");

let session = null;
let presence = null;
let anomaly = null;
let snapshot = null;
let aggregation = null;
let intervalSeconds = 5;
let lastFirestorePresenceBackupAt = 0;

function init({ intervalMs = 5000 } = {}) {
  intervalSeconds = Math.max(1, Math.round(intervalMs / 1000));

  session = sessionEngineMod.createEngine({
    log,
    writer: async (payload) => {
      if (config.firestoreSessionEventsEnabled) {
        await localApiClient.writeFinalizedSession({
          deviceId: payload.deviceId,
          binding: { companyId: payload.companyId, userId: payload.userId },
          session: payload,
        });
      }
      // Inform snapshot engine
      snapshot?.onSessionFinalized(payload);
      // Fan out to incremental analytics aggregation (daily/weekly/monthly)
      try {
        if (config.firestoreAggregatesEnabled) {
          await aggregation?.onSessionFinalized(payload);
        }
      } catch (err) {
        log.warn("aggregation onSessionFinalized failed", { err: err.message });
      }
    },
  });

  presence = presenceEngineMod.createEngine({
    log,
    writer: async (payload) => {
      const now = Date.now();

      try {
        await realtimePresenceStore.upsertPresence(payload);
      } catch (err) {
        log.warn("realtime presence failed", { err: err.message });
      }

      if (!config.firestoreRealtimePresenceEnabled) {
        return;
      }

      if (now - lastFirestorePresenceBackupAt < config.firestorePresenceBackupMs) {
        return;
      }

      await localApiClient.upsertPresence({
        deviceId: payload.deviceId,
        binding: { companyId: payload.companyId, userId: payload.userId },
        presence: payload,
      });
      lastFirestorePresenceBackupAt = now;
    },
  });

  anomaly = anomalyEngineMod.createEngine({
    log,
    writer: async (event) => {
      snapshot?.onAnomaly();
      session?.markAnomaly();
      statsBatchBuffer.markAnomaly();
      if (!config.firestoreAnomalyEventsEnabled) return;
      await localApiClient.writeAnomaly({
        deviceId: event.deviceId,
        binding: { companyId: event.companyId, userId: event.userId },
        event,
      });
    },
  });

  snapshot = snapshotEngineMod.createEngine({
    log,
    writer: async (payload) => {
      if (!config.firestoreSnapshotsEnabled) return;
      await localApiClient.writeSnapshot({
        deviceId: payload.deviceId,
        binding: { companyId: payload.companyId, userId: payload.userId },
        snapshot: payload,
      });
    },
  });

  aggregation = aggregationEngineMod.createEngine({
    log,
    writers: {
      daily: (payload) => localApiClient.writeDailyAnalytics({
        binding: { companyId: payload.companyId, userId: payload.userId },
        payload,
      }),
      weekly: (payload) => localApiClient.writeWeeklyAnalytics({
        binding: { companyId: payload.companyId, userId: payload.userId },
        payload,
      }),
      monthly: (payload) => localApiClient.writeMonthlyAnalytics({
        binding: { companyId: payload.companyId, userId: payload.userId },
        payload,
      }),
    },
  });
}

async function process({ deviceId, binding, sample }) {
  if (!session) init();
  if (!binding?.companyId || !binding?.userId) return;

  // Start snapshot timer once binding is known
  snapshot.start({ deviceId, binding });

  // 1) Sessionization first so presence can attach the active sessionId.
  try {
    await session.observe({ deviceId, binding, sample });
  } catch (err) {
    log.warn("session observe failed", { err: err.message });
  }

  const active = session.getActive();

  // 2) Presence
  try {
    await presence.observe({ deviceId, binding, sample, activeSession: active });
  } catch (err) {
    log.warn("presence observe failed", { err: err.message });
  }

  // 3) Anomaly detection
  try {
    await anomaly.observe({ deviceId, binding, sample });
  } catch (err) {
    log.warn("anomaly observe failed", { err: err.message });
  }

  // 4) Snapshot aggregation
  try {
    snapshot.observe({ sample, intervalSeconds });
  } catch (err) {
    log.warn("snapshot observe failed", { err: err.message });
  }
}

async function flush({ deviceId, binding } = {}) {
  if (!session) return;
  try { await session.flush(); } catch (err) { log.warn("session flush failed", { err: err.message }); }
  try { await snapshot.flushNow(); } catch (err) { log.warn("snapshot flushNow failed", { err: err.message }); }
  if (deviceId && binding) {
    try { await realtimePresenceStore.markOffline({ deviceId, binding }); } catch (err) { log.warn("realtime offline failed", { err: err.message }); }
    try { await presence.markOffline({ deviceId, binding }); } catch (err) { log.warn("presence offline failed", { err: err.message }); }
  }
}

function reset() {
  session?.reset();
  presence?.reset();
  anomaly?.reset();
  snapshot?.reset();
  lastFirestorePresenceBackupAt = 0;
}

function stop() {
  snapshot?.stop();
}

module.exports = { init, process, flush, reset, stop };
