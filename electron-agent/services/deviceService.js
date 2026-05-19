"use strict";

/**
 * Device registration.
 *
 *   POST /api/device/register
 *   Headers: X-VORCE-Agent-Secret: <local-secret>
 *   Body:    { deviceId, binding, info, status }
 *
 * The local API writes the device document at:
 *   companies/{companyId}/device_monitoring/{deviceId}
 */

const tokenStore = require("./tokenStore");
const { collectDeviceInfo } = require("../collectors/deviceInfo");
const deviceIdentity = require("./deviceIdentity");
const userBindingService = require("./userBindingService");
const localApiClient = require("./localApiClient");
const config = require("../core/config");
const { make } = require("../utils/logger");

const log = make("deviceService");

let registrationState = null;

async function registerDevice() {
  const info = await collectDeviceInfo();
  const deviceId = await deviceIdentity.getOrCreateDeviceId();
  const binding = await userBindingService.getAuthenticatedBinding();

  log.info("registering device", {
    deviceId,
    companyId: binding.companyId,
    userId: binding.userId,
  });

  if (config.firestoreDeviceRegistrationEnabled) {
    await localApiClient.registerDevice({
      deviceId,
      binding,
      info,
      status: "online",
    });
  }

  registrationState = { deviceId, info, binding, registered: true };
  tokenStore.setDeviceId(deviceId);
  log.info("device registered", { deviceId });

  return registrationState;
}

async function ensureRegistered() {
  if (registrationState?.deviceId && registrationState?.binding) {
    return { ...registrationState, registered: false };
  }
  return registerDevice();
}

function getDeviceId() {
  return tokenStore.getDeviceId();
}

function getRegistrationState() {
  return registrationState;
}

function resetRegistrationState() {
  registrationState = null;
}

async function markOffline() {
  if (!registrationState?.deviceId || !registrationState?.binding) return;
  if (!config.firestoreDeviceStatusEnabled) return;
  try {
    await localApiClient.updateStatus({
      deviceId: registrationState.deviceId,
      binding: registrationState.binding,
      status: "offline",
    });
  } catch (err) {
    log.warn("failed to mark device offline", { err: err.message });
  }
}

module.exports = {
  registerDevice,
  ensureRegistered,
  getDeviceId,
  getRegistrationState,
  resetRegistrationState,
  markOffline,
};
