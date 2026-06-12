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

async function collectRamLayout() {
  try {
    const layout = await si.memLayout();
    if (Array.isArray(layout) && layout.length > 0) {
      const types = layout.map((x) => x.type).filter(Boolean);
      const uniqueTypes = [...new Set(types)];
      const type = uniqueTypes.join("/") || "Unknown";
      const clockSpeed = layout[0]?.clockSpeed || 0;
      const manufacturers = layout.map((x) => x.manufacturer).filter(Boolean);
      const uniqueManufacturers = [...new Set(manufacturers)];
      const manufacturer = uniqueManufacturers.join("/") || "Unknown";
      return { type, clockSpeed, manufacturer };
    }

    // Fallback for macOS M-series (Apple Silicon SoC unified memory)
    if (process.platform === "darwin") {
      const { exec } = require("child_process");
      const stdout = await new Promise((resolve) => {
        exec("system_profiler SPMemoryDataType", { timeout: 3000 }, (err, stdout) => {
          if (err) resolve("");
          else resolve(stdout);
        });
      });
      const typeMatch = stdout.match(/Type:\s+(.+)/);
      const type = typeMatch ? typeMatch[1].trim() : "LPDDR";
      return { type, clockSpeed: 0, manufacturer: "Apple" };
    }

    return { type: "Unknown", clockSpeed: 0, manufacturer: "Unknown" };
  } catch (err) {
    return { type: "Unknown", clockSpeed: 0, manufacturer: "Unknown" };
  }
}

module.exports = { collectRam, collectRamLayout };

