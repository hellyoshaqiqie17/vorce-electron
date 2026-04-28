"use strict";

/**
 * RAM usage % — uses `active` rather than `used` so cached pages don't make
 * every machine look 95% full. systeminformation aligns this with the
 * Activity Monitor / Task Manager view.
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
