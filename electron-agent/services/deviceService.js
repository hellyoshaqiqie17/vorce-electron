"use strict";

/**
 * Device registration.
 *
 *   POST /device/register
 *   Headers: Authorization: Bearer <token>
 *   Body:    { hostname, os, cpuModel, totalRam }
 *
 * The backend extracts userId/companyId from the bearer token and creates
 * the device document at:
 *   companies/{companyId}/users/{userId}/devices/{deviceId}
 *
 * We NEVER send userId or companyId in the request body.
 */

const config = require("../core/config");
const api = require("./apiClient");
const tokenStore = require("./tokenStore");
const { collectDeviceInfo } = require("../collectors/deviceInfo");
const { make } = require("../utils/logger");

const log = make("deviceService");

async function registerDevice() {
  const info = await collectDeviceInfo();

  const payload = {
    hostname: info.hostname,
    os: info.os,
    cpuModel: info.cpuModel,
    totalRam: info.totalRamGb,
  };

  log.info("registering device", payload);

  const data = await api.post(config.endpoints.deviceRegister, payload);
  const deviceId = data && (data.deviceId || data.id);
  if (!deviceId) {
    throw new Error("Server tidak mengembalikan deviceId.");
  }

  tokenStore.setDeviceId(deviceId);
  log.info("device registered", { deviceId });

  return { deviceId };
}

async function ensureRegistered() {
  const cached = tokenStore.getDeviceId();
  if (cached) return { deviceId: cached, registered: false };
  const out = await registerDevice();
  return { ...out, registered: true };
}

function getDeviceId() {
  return tokenStore.getDeviceId();
}

module.exports = {
  registerDevice,
  ensureRegistered,
  getDeviceId,
};
