"use strict";

const os = require("os");
const si = require("systeminformation");

let previousStats = null;

function round(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function findPrimaryInterface() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const item of entries || []) {
      if (item && item.family === "IPv4" && !item.internal) {
        return {
          localIp: item.address || "",
          macAddress: item.mac || "",
          iface: item.name || "",
        };
      }
    }
  }
  return { localIp: "", macAddress: "", iface: "" };
}

async function collectNetwork() {
  const primary = findPrimaryInterface();
  let uploadKBps = 0;
  let downloadKBps = 0;

  try {
    const stats = await si.networkStats(primary.iface || "*");
    const current = Array.isArray(stats) ? stats[0] : stats;
    if (current) {
      if (Number.isFinite(Number(current.tx_sec)) || Number.isFinite(Number(current.rx_sec))) {
        uploadKBps = Number(current.tx_sec) / 1024;
        downloadKBps = Number(current.rx_sec) / 1024;
      } else if (previousStats?.timestamp) {
        const elapsedSeconds = Math.max(1, (Date.now() - previousStats.timestamp) / 1000);
        uploadKBps = (Number(current.tx_bytes || 0) - previousStats.txBytes) / elapsedSeconds / 1024;
        downloadKBps = (Number(current.rx_bytes || 0) - previousStats.rxBytes) / elapsedSeconds / 1024;
      }
      previousStats = {
        timestamp: Date.now(),
        txBytes: Number(current.tx_bytes || 0),
        rxBytes: Number(current.rx_bytes || 0),
      };
    }
  } catch (_) {
    uploadKBps = 0;
    downloadKBps = 0;
  }

  return {
    ...primary,
    uploadKBps: Math.max(0, round(uploadKBps, 1)),
    downloadKBps: Math.max(0, round(downloadKBps, 1)),
  };
}

module.exports = { collectNetwork };
