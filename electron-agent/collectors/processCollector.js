"use strict";

const pidusage = require("pidusage");
const si = require("systeminformation");
const { collectActivity } = require("./activityCollector");

function round(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

async function collectProcess(activity) {
  const processInfo = activity || await collectActivity();
  const pid = Number(processInfo.pid || 0) || 0;
  let usage = null;

  if (pid > 0) {
    try {
      usage = await pidusage(pid);
    } catch (_) {
      usage = null;
    }
  }

  return {
    appName: processInfo.appName || "Unknown",
    windowTitle: processInfo.windowTitle || "",
    executable: processInfo.executable || "",
    pid,
    cpuPercent: round(usage?.cpu || 0, 1),
    memoryMB: round((usage?.memory || 0) / 1024 / 1024, 1),
  };
}

async function collectTopProcesses(limit = 3) {
  try {
    const [data, memInfo] = await Promise.all([si.processes(), si.mem()]);
    const totalMB = (memInfo.total || 0) / 1024 / 1024;
    const NOISE = ["system idle process", "system", "secure system", "registry", "memory compression", "smss.exe", "csrss.exe"];
    const list = (data.list || [])
      .filter((p) => p.memRss > 0 && !NOISE.includes((p.name || "").toLowerCase()))
      .sort((a, b) => b.memRss - a.memRss)
      .slice(0, limit)
      .map((p) => ({
        name: p.name || "Unknown",
        pid: p.pid,
        memoryMB: round(p.memRss / 1024, 1),
        cpuPercent: round(p.cpu || 0, 1),
      }));
    return list;
  } catch (_) {
    return [];
  }
}

module.exports = { collectProcess, collectTopProcesses };
