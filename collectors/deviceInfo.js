"use strict";

/**
 * Static device fingerprint collected once at registration time.
 *
 * Fields exactly match the spec contract:
 *   { hostname, os, cpuModel, totalRamGb }
 *
 * No serial numbers, no MAC addresses, no disk UUIDs — registering by
 * hostname is enough for the backend to issue a deviceId and we don't need
 * to expand the surface area of personally identifying hardware data.
 */

const os = require("os");
const si = require("systeminformation");

const BYTES_PER_GB = 1024 * 1024 * 1024;

async function collectDeviceInfo() {
  const [cpu, osInfo] = await Promise.all([si.cpu(), si.osInfo()]);

  const cpuModel = [cpu.manufacturer, cpu.brand]
    .filter(Boolean)
    .join(" ")
    .trim() || os.cpus()[0]?.model || "Unknown CPU";

  const osLabel = [osInfo.distro || osInfo.platform, osInfo.release]
    .filter(Boolean)
    .join(" ")
    .trim() || `${os.type()} ${os.release()}`;

  const totalRamGb = Math.round((os.totalmem() / BYTES_PER_GB) * 10) / 10;

  return {
    hostname: os.hostname(),
    os: osLabel,
    cpuModel,
    totalRamGb,
  };
}

module.exports = { collectDeviceInfo };
