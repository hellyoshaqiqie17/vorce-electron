"use strict";

const path = require("path");
const si = require("systeminformation");

const BYTES_PER_GB = 1024 * 1024 * 1024;

function round(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function getCurrentDriveMount() {
  const root = path.parse(process.cwd()).root.replace(/\\$/, "").toLowerCase();
  return root || null;
}

async function collectStorage() {
  const fsSizes = await si.fsSize();
  const currentMount = getCurrentDriveMount();
  const disk = fsSizes.find((item) => {
    const mount = String(item.mount || item.fs || "").replace(/\\$/, "").toLowerCase();
    return currentMount && mount === currentMount;
  }) || fsSizes[0] || {};

  const size = Number(disk.size) || 0;
  const used = Number(disk.used) || 0;
  const free = Number(disk.available ?? (size - used)) || 0;
  const usagePercent = Number.isFinite(Number(disk.use))
    ? Number(disk.use)
    : size > 0 ? (used / size) * 100 : 0;

  return {
    usedGB: round(used / BYTES_PER_GB, 2),
    freeGB: round(free / BYTES_PER_GB, 2),
    usagePercent: Math.max(0, Math.min(100, round(usagePercent, 1))),
  };
}

module.exports = { collectStorage };
