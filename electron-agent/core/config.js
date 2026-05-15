"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Central configuration for the VORCE Electron Agent.
 *
 * Defaults match the existing VORCE Cloud Functions deployment.
 * Environment variables override at startup so the same build can target
 * staging / production without rebundling.
 */

const DEFAULT_API_BASE_URL =
  "https://asia-southeast2-hora-7394b.cloudfunctions.net/api";

function loadEnvFile() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnvFile();

const config = {
  apiBaseUrl: process.env.VORCE_API_BASE_URL || DEFAULT_API_BASE_URL,

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

  mqtt: {
    enabled: process.env.VORCE_MQTT_ENABLED !== "false",
    brokerUrl: process.env.MQTT_BROKER_URL ||
      "wss://e7ba5537e0b8465cad8d146ee6868d84.s1.eu.hivemq.cloud:8884/mqtt",
    username: process.env.MQTT_USERNAME || "",
    password: process.env.MQTT_PASSWORD || "",
    qos: Number(process.env.VORCE_MQTT_QOS) || 1,
    reconnectPeriodMs: Number(process.env.VORCE_MQTT_RECONNECT_MS) || 5_000,
    connectTimeoutMs: Number(process.env.VORCE_MQTT_CONNECT_TIMEOUT_MS) || 10_000,
    fallbackToFirestore: process.env.VORCE_MQTT_FIRESTORE_FALLBACK !== "false",
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
