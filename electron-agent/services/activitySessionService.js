"use strict";

const crypto = require("crypto");
const deviceService = require("./deviceService");
const localApiClient = require("./localApiClient");
const { make } = require("../utils/logger");

const log = make("activitySessionService");

let currentSession = null;
let lastWriteAt = 0;
const MIN_SESSION_SECONDS = 2;
const UPDATE_INTERVAL_MS = 30000;

function clean(value) {
  return String(value || "").trim();
}

function sessionKey(processInfo) {
  const appName = clean(processInfo.appName).toLowerCase();
  const winTitle = clean(processInfo.windowTitle).toLowerCase();
  const exe = clean(processInfo.executable).toLowerCase();

  // Browser: each tab is a separate session (include window title)
  const isBrowser = /chrome|firefox|edge|brave|opera|safari/.test(appName) || /chrome|firefox|edge|brave|opera|safari/.test(exe);
  if (isBrowser) {
    return [appName, winTitle].join("|");
  }

  // All other apps: one session per appName (ignore window title)
  return appName;
}

function createSessionId(deviceId, key, startedAt) {
  return crypto
    .createHash("sha1")
    .update(`${deviceId}|${key}|${startedAt}`)
    .digest("hex")
    .slice(0, 24);
}

function toSessionPayload(session, endedAt = null) {
  const end = endedAt || session.lastSeenAt || session.startedAt;
  return {
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    userId: session.binding.userId,
    companyId: session.binding.companyId,
    appName: session.process.appName || "Unknown",
    windowTitle: session.process.windowTitle || "",
    executable: session.process.executable || "",
    pid: Number(session.process.pid) || 0,
    startedAt: session.startedAt,
    lastSeenAt: session.lastSeenAt || end,
    endedAt,
    durationSeconds: Math.max(0, Math.round((end - session.startedAt))),
    isActive: !endedAt,
  };
}

async function writeSession(session, endedAt = null) {
  await localApiClient.upsertActivitySession({
    deviceId: session.deviceId,
    binding: session.binding,
    session: toSessionPayload(session, endedAt),
  });
  lastWriteAt = Date.now();
}

async function track(sample) {
  const processInfo = sample?.process || {};
  const appName = clean(processInfo.appName);
  const now = Number(sample?.timestamp) || Math.floor(Date.now() / 1000);

  if (!appName || appName === "Unknown") return;

  const state = deviceService.getRegistrationState() || await deviceService.ensureRegistered();
  const key = sessionKey(processInfo);

  if (!currentSession) {
    currentSession = {
      sessionId: createSessionId(state.deviceId, key, now),
      deviceId: state.deviceId,
      binding: state.binding,
      process: { ...processInfo, appName },
      key,
      startedAt: now,
      lastSeenAt: now,
    };
    await writeSession(currentSession);
    return;
  }

  if (currentSession.key !== key) {
    // End previous session
    const duration = Math.max(0, now - currentSession.startedAt);
    if (duration >= MIN_SESSION_SECONDS) {
      currentSession.lastSeenAt = now;
      await writeSession(currentSession, now);
    }

    // Start new session for the new app
    currentSession = {
      sessionId: createSessionId(state.deviceId, key, now),
      deviceId: state.deviceId,
      binding: state.binding,
      process: { ...processInfo, appName },
      key,
      startedAt: now,
      lastSeenAt: now,
    };
    await writeSession(currentSession);
    return;
  }

  // Same app: just update lastSeenAt (do NOT reset startedAt)
  currentSession.lastSeenAt = now;
  if (Date.now() - lastWriteAt > UPDATE_INTERVAL_MS) {
    await writeSession(currentSession);
  }
}

async function flush() {
  if (!currentSession) return;
  const endedAt = Math.floor(Date.now() / 1000);
  await writeSession(currentSession, endedAt);
  currentSession = null;
}

function reset() {
  currentSession = null;
  lastWriteAt = 0;
}

module.exports = {
  track,
  flush,
  reset,
};
