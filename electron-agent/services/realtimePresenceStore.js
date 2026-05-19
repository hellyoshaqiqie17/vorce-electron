"use strict";

const {
  ref,
  set,
  update,
  onDisconnect,
  serverTimestamp,
} = require("firebase/database");
const firebaseClient = require("../firebase/firebaseClient");
const config = require("../core/config");
const { make } = require("../utils/logger");

const log = make("realtimePresenceStore");

const connectedPaths = new Set();

function safeKey(value) {
  return String(value || "")
    .replace(/[.#$\[\]\/]/g, "_")
    .trim();
}

function statusPath(companyId, deviceId) {
  const companyKey = safeKey(companyId);
  const deviceKey = safeKey(deviceId);
  if (!companyKey) throw new Error("companyId belum tersedia.");
  if (!deviceKey) throw new Error("deviceId belum tersedia.");
  return `status/${companyKey}/${deviceKey}`;
}

function normalizePresence(payload) {
  const state = payload.state === "idle" || payload.state === "away" || payload.state === "offline"
    ? payload.state
    : "online";

  return {
    deviceId: payload.deviceId,
    companyId: payload.companyId,
    userId: payload.userId,
    userEmail: payload.userEmail || "",
    userName: payload.userName || "",
    state,
    currentApp: payload.currentApp || "Unknown",
    currentCategory: payload.currentCategory || "unknown",
    activeWindow: config.privacy.sendActiveWindowTitle ? payload.activeWindow || "" : "",
    executable: payload.executable || "",
    cpuNow: Number(payload.cpuNow) || 0,
    ramNow: Number(payload.ramNow) || 0,
    healthScore: Number(payload.healthScore) || 0,
    sessionId: payload.sessionId || null,
    sessionStartedAt: payload.sessionStartedAt || null,
    lastSeen: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function ensureDisconnectHandler(payload) {
  const path = statusPath(payload.companyId, payload.deviceId);
  if (connectedPaths.has(path)) return;

  const db = firebaseClient.getRealtimeDb();
  const presenceRef = ref(db, path);

  await onDisconnect(presenceRef).update({
    state: "offline",
    lastSeen: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  connectedPaths.add(path);
  log.info("onDisconnect registered", { path });
}

async function upsertPresence(payload) {
  if (!payload?.companyId || !payload?.deviceId || !payload?.userId) return false;

  await ensureDisconnectHandler(payload);
  const db = firebaseClient.getRealtimeDb();
  const presenceRef = ref(db, statusPath(payload.companyId, payload.deviceId));
  await set(presenceRef, normalizePresence(payload));
  log.debug("presence updated", { deviceId: payload.deviceId, app: payload.currentApp });
  return true;
}

async function markOffline({ deviceId, binding }) {
  if (!deviceId || !binding?.companyId || !binding?.userId) return false;

  const db = firebaseClient.getRealtimeDb();
  const presenceRef = ref(db, statusPath(binding.companyId, deviceId));
  await update(presenceRef, {
    deviceId,
    companyId: binding.companyId,
    userId: binding.userId,
    state: "offline",
    lastSeen: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  log.info("presence offline", { deviceId });
  return true;
}

async function upsertStatsSummary(payload) {
  if (!payload?.companyId || !payload?.deviceId || !payload?.userId) return false;

  const db = firebaseClient.getRealtimeDb();
  const summaryRef = ref(db, `stats/${safeKey(payload.companyId)}/${safeKey(payload.deviceId)}`);
  await set(summaryRef, {
    ...payload,
    updatedAt: serverTimestamp(),
  });
  log.debug("stats summary updated", { deviceId: payload.deviceId, date: payload.date });
  return true;
}

module.exports = {
  upsertPresence,
  markOffline,
  upsertStatsSummary,
};
