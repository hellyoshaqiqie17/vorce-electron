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
    login: "/auth/login",
    deviceRegister: "/device/register",
    deviceMetrics: "/device/metrics",
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
