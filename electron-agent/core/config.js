"use strict";

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

/**
 * Central configuration for the VORCE Electron Agent.
 *
 * Defaults match the existing VORCE Cloud Functions deployment.
 * Environment variables override at startup so the same build can target
 * staging / production without rebundling.
 */

const DEFAULT_API_BASE_URL =
  "https://asia-southeast2-hora-7394b.cloudfunctions.net/api";

const config = {
  apiBaseUrl: process.env.VORCE_API_BASE_URL || DEFAULT_API_BASE_URL,

  firebase: {
    apiKey: "AIzaSyDcc3oP_lGYg9ikBn0mq--wdH27aQ5LFlc",
    authDomain: "hora-7394b.firebaseapp.com",
    databaseURL: "https://hora-7394b-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "hora-7394b",
    storageBucket: "hora-7394b.firebasestorage.app",
    messagingSenderId: "544676101248",
    appId: "1:544676101248:web:708c651f6c3d20a5b1ba65",
    measurementId: "G-F9K8JMYEZN",
  },

  metricsIntervalMs: Number(process.env.VORCE_METRICS_INTERVAL_MS) || 5_000,
  realtimePresenceIntervalMs: Number(process.env.VORCE_REALTIME_PRESENCE_INTERVAL_MS) || 5_000,
  firestoreRealtimePresenceEnabled: process.env.VORCE_FIRESTORE_REALTIME_PRESENCE !== "false",
  firestoreHeartbeatEnabled: process.env.VORCE_FIRESTORE_HEARTBEAT !== "false",
  firestoreDeviceStatusEnabled: process.env.VORCE_FIRESTORE_DEVICE_STATUS !== "false",
  firestoreDeviceRegistrationEnabled: process.env.VORCE_FIRESTORE_DEVICE_REGISTRATION !== "false",
  firestoreSessionEventsEnabled: process.env.VORCE_FIRESTORE_SESSION_EVENTS !== "false",
  firestoreSnapshotsEnabled: process.env.VORCE_FIRESTORE_SNAPSHOTS !== "false",
  firestoreAnomalyEventsEnabled: process.env.VORCE_FIRESTORE_ANOMALY_EVENTS !== "false",
  firestoreAggregatesEnabled: process.env.VORCE_FIRESTORE_AGGREGATES !== "false",
  firestorePresenceBackupMs: Number(process.env.VORCE_FIRESTORE_PRESENCE_BACKUP_MS) || 3_600_000,
  firestoreHeartbeatMs: Number(process.env.VORCE_FIRESTORE_HEARTBEAT_MS) || 3_600_000,
  statsCheckpointMs: Number(process.env.VORCE_STATS_CHECKPOINT_MS) || 60_000,
  realtimeStatsSummaryMs: Number(process.env.VORCE_REALTIME_STATS_SUMMARY_MS) || 300_000,
  firestoreStatsSummaryMs: Number(process.env.VORCE_FIRESTORE_STATS_SUMMARY_MS) || 600_000,
  firestoreStatsSummaryOnStop: process.env.VORCE_FIRESTORE_STATS_ON_STOP !== "false",

  http: {
    timeoutMs: 15_000,
    retries: 3,
    retryBaseDelayMs: 1_000,
  },

  privacy: {
    sendActiveWindowTitle: true,
    sendActiveAppName: true,
  },

  storage: {
    tokenFile: "vlinked-agent-token.bin",
    stateFile: "vlinked-agent-state.json",
    statsBufferFile: "vlinked-agent-stats-buffer.json",
  },

  idleThresholdSeconds: 60,
};

module.exports = config;
