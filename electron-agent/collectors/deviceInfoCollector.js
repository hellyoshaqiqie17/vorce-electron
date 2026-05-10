"use strict";

const os = require("os");
const si = require("systeminformation");
const { readMachineId } = require("../services/deviceIdentity");
const { collectBattery } = require("./batteryCollector");
const { collectGpu } = require("./gpuCollector");
const { collectNetwork } = require("./networkCollector");
const { collectRam } = require("./ramCollector");

function round(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

async function fallback(valuePromise, fallbackValue) {
  try {
    return await valuePromise;
  } catch (_) {
    return fallbackValue;
  }
}

async function collectDeviceInfo() {
  const [machineId, osInfo, cpu, ram, gpu, battery, network] = await Promise.all([
    fallback(readMachineId(), ""),
    fallback(si.osInfo(), {}),
    fallback(si.cpu(), {}),
    fallback(collectRam(), { totalGB: round(os.totalmem() / 1024 / 1024 / 1024, 2) }),
    fallback(collectGpu(), { vendor: "", model: "", vramMB: 0 }),
    fallback(collectBattery(), { hasBattery: false, percent: 0, charging: false }),
    fallback(collectNetwork(), { localIp: "", macAddress: "" }),
  ]);

  const cpuBrand = [cpu.manufacturer, cpu.brand].filter(Boolean).join(" ").trim() || os.cpus()[0]?.model || "Unknown CPU";
  const osLabel = [osInfo.distro || osInfo.platform || os.type(), osInfo.release || os.release()]
    .filter(Boolean)
    .join(" ")
    .trim();

  return {
    hostname: os.hostname(),
    machineId,
    platform: os.platform(),
    arch: os.arch(),
    os: osLabel || `${os.type()} ${os.release()}`,
    osVersion: osInfo.codename || osInfo.build || osInfo.release || os.release(),
    osRelease: osInfo.release || os.release(),
    kernel: osInfo.kernel || os.release(),
    cpu: {
      manufacturer: cpu.manufacturer || "",
      brand: cpu.brand || cpuBrand,
      physicalCores: Number(cpu.physicalCores || 0) || 0,
      logicalCores: Number(cpu.cores || os.cpus().length || 0) || 0,
      speedGHz: round(cpu.speed || 0, 2),
    },
    ram: {
      totalGB: Number(ram.totalGB) || 0,
    },
    gpu,
    battery,
    network: {
      localIp: network.localIp || "",
      macAddress: network.macAddress || "",
    },
    cpuModel: cpuBrand,
    totalRam: Number(ram.totalGB) || 0,
    totalRamGb: Number(ram.totalGB) || 0,
  };
}

module.exports = { collectDeviceInfo };
