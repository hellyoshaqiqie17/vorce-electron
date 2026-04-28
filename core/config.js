"use strict";

/**
 * Central configuration for the VORCE Electron Agent.
 *
 * The defaults mirror the existing VORCE Cloud Functions deployment that the
 * web admin uses. Environment variables override at startup so the same build
 * can ship to staging / prod without rebundling.
 */

const DEFAULT_API_BASE_URL =
  "https://asia-southeast2-hora-7394b.cloudfunctions.net/api";

const config = {
  // Backend
  apiBaseUrl: process.env.VORCE_API_BASE_URL || DEFAULT_API_BASE_URL,

  // Endpoints (relative to apiBaseUrl). Match the spec exactly.
  endpoints: {
    login: "/auth/login",
    deviceRegister: "/device/register",
    deviceMetrics: "/device/metrics",
  },

  // Sampling cadence
  metricsIntervalMs: Number(process.env.VORCE_METRICS_INTERVAL_MS) || 5_000,

  // HTTP behaviour
  http: {
    timeoutMs: 15_000,
    retries: 3,
    retryBaseDelayMs: 1_000,
  },

  // Privacy toggles. Per spec we ship app name + window title; flip to false
  // here if a tenant's policy forbids titles.
  privacy: {
    sendActiveWindowTitle: true,
    sendActiveAppName: true,
  },

  // Storage keys (used by tokenStore + simple JSON state on disk).
  storage: {
    tokenFile: "vorce-agent-token.bin",
    stateFile: "vorce-agent-state.json",
  },

  // Idle threshold — anything ≥ this many seconds counts as "idle".
  idleThresholdSeconds: 60,
};

module.exports = config;
