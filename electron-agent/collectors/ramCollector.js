"use strict";

const si = require("systeminformation");

const BYTES_PER_GB = 1024 * 1024 * 1024;

function round(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

async function collectRam() {
  const mem = await si.mem();
  const total = Number(mem?.total) || 0;
  const free = Number(mem?.available ?? mem?.free) || 0;
  const used = Math.max(0, total - free);
  const usagePercent = total > 0 ? (used / total) * 100 : 0;

  return {
    usagePercent: Math.max(0, Math.min(100, round(usagePercent, 1))),
    usedGB: round(used / BYTES_PER_GB, 2),
    freeGB: round(free / BYTES_PER_GB, 2),
    totalGB: round(total / BYTES_PER_GB, 2),
  };
}

module.exports = { collectRam };
