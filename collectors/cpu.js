"use strict";

/**
 * CPU usage % across all cores. systeminformation samples the kernel counters
 * over a short window, so the first call after boot can return 0 — that's
 * fine, the next interval will produce a real number.
 */

const si = require("systeminformation");

async function getCpuUsage() {
  const load = await si.currentLoad();
  const value = Number(load && load.currentLoad);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

module.exports = { getCpuUsage };
