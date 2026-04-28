"use strict";

/**
 * Encrypted-at-rest token + agent state storage.
 *
 * - Token is stored using Electron's safeStorage (DPAPI on Windows,
 *   Keychain on macOS, libsecret on Linux). On unsupported platforms it falls
 *   back to plaintext but logs a warning so operators can spot it.
 * - Non-secret state (deviceId, lastUserId for UI rehydrate) is stored in a
 *   small JSON file beside it.
 *
 * The store is process-local — only the Electron main process uses it. The
 * renderer never touches the filesystem directly.
 */

const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");
const config = require("../core/config");
const { make } = require("../utils/logger");

const log = make("tokenStore");

function tokenPath() {
  return path.join(app.getPath("userData"), config.storage.tokenFile);
}

function statePath() {
  return path.join(app.getPath("userData"), config.storage.stateFile);
}

function ensureUserDataDir() {
  const dir = app.getPath("userData");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    /* already exists */
  }
}

function safeStorageAvailable() {
  try {
    return safeStorage && safeStorage.isEncryptionAvailable();
  } catch (_) {
    return false;
  }
}

/* ───────────────── token (secret) ───────────────── */

function saveToken(token) {
  if (!token || typeof token !== "string") return;
  ensureUserDataDir();
  try {
    if (safeStorageAvailable()) {
      const buf = safeStorage.encryptString(token);
      fs.writeFileSync(tokenPath(), buf);
    } else {
      log.warn(
        "OS-level encryption unavailable; persisting token in plaintext. " +
          "Install/configure a system keyring to enable safeStorage."
      );
      fs.writeFileSync(tokenPath(), Buffer.from(token, "utf8"));
    }
  } catch (err) {
    log.error("Failed to persist token", { err: err.message });
  }
}

function loadToken() {
  try {
    const p = tokenPath();
    if (!fs.existsSync(p)) return null;
    const buf = fs.readFileSync(p);
    if (safeStorageAvailable()) {
      try {
        return safeStorage.decryptString(buf);
      } catch (_) {
        // File written before encryption was available — treat as plaintext.
        return buf.toString("utf8");
      }
    }
    return buf.toString("utf8");
  } catch (err) {
    log.error("Failed to read token", { err: err.message });
    return null;
  }
}

function clearToken() {
  try {
    fs.unlinkSync(tokenPath());
  } catch (_) {
    /* missing is fine */
  }
}

/* ───────────────── non-secret state ───────────────── */

function readState() {
  try {
    const p = statePath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8")) || {};
  } catch (err) {
    log.warn("State file unreadable, resetting", { err: err.message });
    return {};
  }
}

function writeState(next) {
  ensureUserDataDir();
  try {
    fs.writeFileSync(statePath(), JSON.stringify(next, null, 2));
  } catch (err) {
    log.error("Failed to write state", { err: err.message });
  }
}

function getDeviceId() {
  return readState().deviceId || null;
}

function setDeviceId(deviceId) {
  const next = readState();
  next.deviceId = deviceId;
  writeState(next);
}

function clearDeviceId() {
  const next = readState();
  delete next.deviceId;
  writeState(next);
}

function getDisplayEmail() {
  return readState().displayEmail || null;
}

function setDisplayEmail(email) {
  const next = readState();
  if (email) next.displayEmail = email;
  else delete next.displayEmail;
  writeState(next);
}

module.exports = {
  saveToken,
  loadToken,
  clearToken,
  getDeviceId,
  setDeviceId,
  clearDeviceId,
  getDisplayEmail,
  setDisplayEmail,
};
