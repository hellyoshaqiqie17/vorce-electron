"use strict";

const os = require("os");
const crypto = require("crypto");
const si = require("systeminformation");
const { machineId } = require("node-machine-id");
const tokenStore = require("./tokenStore");
const { make } = require("../utils/logger");

const log = make("deviceIdentity");

function normalizePart(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function readMachineId() {
  try {
    const id = await machineId(false);
    if (id) return id;
  } catch (err) {
    log.warn("node-machine-id read failed", { err: err.message });
  }

  try {
    const uuid = await si.uuid();
    return (
      uuid &&
      (uuid.hardware || uuid.os || (Array.isArray(uuid.macs) ? uuid.macs.join(":") : ""))
    ) || "";
  } catch (err) {
    log.warn("machine id read failed", { err: err.message });
    return "";
  }
}

async function generateDeviceId() {
  const hostname = os.hostname();
  const machineId = await readMachineId();
  const seed = `${machineId}|${hostname}|${os.platform()}|${os.arch()}`;
  const hash = crypto.createHash("sha256").update(seed).digest("hex").slice(0, 24);
  const hostPart = normalizePart(hostname).slice(0, 32) || "unknown-host";
  return `desktop_${hostPart}_${hash}`;
}

async function getOrCreateDeviceId() {
  const cached = tokenStore.getDeviceId();
  if (cached) {
    if (cached.includes(".")) {
      const migrated = cached.replace(/\./g, "-");
      tokenStore.setDeviceId(migrated);
      log.info("Migrated deviceId with dots to hyphens", { old: cached, new: migrated });
      return migrated;
    }
    return cached;
  }
  const deviceId = await generateDeviceId();
  tokenStore.setDeviceId(deviceId);
  return deviceId;
}

module.exports = {
  readMachineId,
  getOrCreateDeviceId,
  generateDeviceId,
};
