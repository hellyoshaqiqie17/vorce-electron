"use strict";

/**
 * CPU usage % across all cores via systeminformation.
 */

const si = require("systeminformation");

async function getCpuUsage() {
  const load = await si.currentLoad();
  const value = Number(load && load.currentLoad);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

module.exports = { getCpuUsage };
