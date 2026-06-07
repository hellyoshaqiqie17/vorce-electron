"use strict";

const {
  ref,
  set,
  update,
  onDisconnect,
  serverTimestamp,
  onValue,
} = require("firebase/database");
const firebaseClient = require("../firebase/firebaseClient");
const config = require("../core/config");
const { make } = require("../utils/logger");
const deviceControl = require("../utils/deviceControl");

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

  if (state === "offline") {
    const out = {
      deviceId: safeKey(payload.deviceId),
      companyId: safeKey(payload.companyId),
      userId: payload.userId,
      state: "offline",
      lastSeen: serverTimestamp(),
      updatedAt: serverTimestamp(),
      currentApp: null,
      currentCategory: null,
      activeWindow: null,
      executable: null,
      cpuNow: null,
      ramNow: null,
      gpuNow: null,
      healthScore: null,
      sessionId: null,
      sessionStartedAt: null,
      wifi: null,
      location: null,
      localIp: null,
    };
    if (payload.userEmail) out.userEmail = payload.userEmail;
    if (payload.userName) out.userName = payload.userName;
    return out;
  }

  const out = {
    deviceId: safeKey(payload.deviceId),
    companyId: safeKey(payload.companyId),
    userId: payload.userId,
    state,
    currentApp: payload.currentApp || "Unknown",
    currentCategory: payload.currentCategory || "unknown",
    activeWindow: config.privacy.sendActiveWindowTitle ? payload.activeWindow || "" : "",
    executable: payload.executable || "",
    cpuNow: Number(payload.cpuNow) || 0,
    ramNow: Number(payload.ramNow) || 0,
    gpuNow: Number(payload.gpuNow) || 0,
    healthScore: Number(payload.healthScore) || 0,
    sessionId: payload.sessionId || null,
    sessionStartedAt: payload.sessionStartedAt || null,
    lastSeen: serverTimestamp(),
    updatedAt: serverTimestamp(),
    wifi: payload.wifi || "",
    location: payload.location || "",
    localIp: payload.localIp || "",
  };

  if (payload.userEmail) out.userEmail = payload.userEmail;
  if (payload.userName) out.userName = payload.userName;

  return out;
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
  await update(presenceRef, normalizePresence(payload));
  log.debug("presence updated", { deviceId: payload.deviceId, app: payload.currentApp });
  return true;
}

async function markOffline({ deviceId, binding }) {
  if (!deviceId || !binding?.companyId || !binding?.userId) return false;

  const db = firebaseClient.getRealtimeDb();
  const presenceRef = ref(db, statusPath(binding.companyId, deviceId));
  await update(presenceRef, {
    deviceId: safeKey(deviceId),
    companyId: safeKey(binding.companyId),
    userId: binding.userId,
    userName: binding.displayName || "",
    userEmail: binding.email || "",
    state: "offline",
    lastSeen: serverTimestamp(),
    updatedAt: serverTimestamp(),
    currentApp: null,
    currentCategory: null,
    activeWindow: null,
    executable: null,
    cpuNow: null,
    ramNow: null,
    gpuNow: null,
    healthScore: null,
    sessionId: null,
    sessionStartedAt: null,
    wifi: null,
    location: null,
    localIp: null,
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
    companyId: safeKey(payload.companyId),
    deviceId: safeKey(payload.deviceId),
    updatedAt: serverTimestamp(),
  });
  log.debug("stats summary updated", { deviceId: payload.deviceId, date: payload.date });
  return true;
}

let currentListenerPath = null;
let commandListenerUnsubscribe = null;

function startCommandListener(companyId, deviceId) {
  if (!companyId || !deviceId) return;
  const path = statusPath(companyId, deviceId);
  if (currentListenerPath === path) return;

  stopCommandListener();
  currentListenerPath = path;

  log.info("Starting remote control command listener", { path });
  const db = firebaseClient.getRealtimeDb();
  const presenceRef = ref(db, path);

  commandListenerUnsubscribe = onValue(presenceRef, async (snapshot) => {
    const data = snapshot.val();
    if (!data) return;

    if (data.lockDevice === true) {
      log.warn("Remote lock command received");
      try {
        await update(presenceRef, { lockDevice: false });
      } catch (err) {
        log.error("Failed to reset lockDevice status", { err: err.message });
      }
      deviceControl.lockWorkstation();
    }

    if (data.shutdownDevice === true) {
      log.warn("Remote shutdown command received");
      try {
        await update(presenceRef, { shutdownDevice: false });
      } catch (err) {
        log.error("Failed to reset shutdownDevice status", { err: err.message });
      }
      deviceControl.shutdownDevice();
    }
  }, (err) => {
    log.error("Error in remote control command listener", { err: err.message });
  });
}

function stopCommandListener() {
  if (commandListenerUnsubscribe) {
    commandListenerUnsubscribe();
    commandListenerUnsubscribe = null;
    log.info("Remote control command listener stopped");
  }
  currentListenerPath = null;
}

module.exports = {
  upsertPresence,
  markOffline,
  upsertStatsSummary,
  startCommandListener,
  stopCommandListener,
};
