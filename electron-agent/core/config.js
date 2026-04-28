"use strict";

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

  endpoints: {
    loginGoogle: "/api/Login/login-google-admin",
    deviceRegister: "/device/register",
    deviceMetrics: "/device/metrics",
  },

  firebase: {
    apiKey: "AIzaSyDcc3oP_lGYg9ikBn0mq--wdH27aQ5LFlc",
    authDomain: "hora-7394b.firebaseapp.com",
    projectId: "hora-7394b",
    storageBucket: "hora-7394b.firebasestorage.app",
    messagingSenderId: "544676101248",
    appId: "1:544676101248:web:708c651f6c3d20a5b1ba65",
    measurementId: "G-F9K8JMYEZN",
  },

  metricsIntervalMs: Number(process.env.VORCE_METRICS_INTERVAL_MS) || 5_000,

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
    tokenFile: "vorce-agent-token.bin",
    stateFile: "vorce-agent-state.json",
  },

  idleThresholdSeconds: 60,
};

module.exports = config;
