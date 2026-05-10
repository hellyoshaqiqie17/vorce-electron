"use strict";

const si = require("systeminformation");

function round(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

async function collectCpu() {
  const [load, speed] = await Promise.all([
    si.currentLoad(),
    si.cpuCurrentSpeed().catch(() => null),
  ]);

  const usagePercent = Math.max(0, Math.min(100, round(load?.currentLoad || 0, 1)));
  const currentSpeedGHz = round(speed?.avg || speed?.min || speed?.max || 0, 2);

  return {
    usagePercent,
    currentSpeedGHz,
  };
}

module.exports = { collectCpu };
