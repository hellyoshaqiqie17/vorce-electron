"use strict";

/**
 * RAM usage % via systeminformation.
 * Uses `active` rather than `used` so cached pages don't inflate numbers.
 */

const si = require("systeminformation");

async function getMemoryUsage() {
  const mem = await si.mem();
  if (!mem || !mem.total) return 0;
  const active = mem.active || mem.used || 0;
  const pct = (active / mem.total) * 100;
  return Math.max(0, Math.min(100, pct));
}

module.exports = { getMemoryUsage };
