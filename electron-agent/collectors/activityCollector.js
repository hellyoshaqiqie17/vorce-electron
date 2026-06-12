"use strict";

let activeWinPromise = null;
let lastKnownActivity = null;

function loadActiveWin() {
  if (!activeWinPromise) {
    activeWinPromise = import("active-win").then((m) => m.default || m);
  }
  return activeWinPromise;
}

function normalize(result) {
  if (!result) {
    return {
      appName: "Unknown",
      windowTitle: "",
      executable: "",
      pid: 0,
    };
  }

  const owner = result.owner || {};
  return {
    appName: owner.name || owner.processName || "Unknown",
    windowTitle: result.title || "",
    executable: owner.path || "",
    pid: Number(owner.processId || owner.pid || 0) || 0,
  };
}

async function collectActivity() {
  try {
    const activeWin = await loadActiveWin();
    let hasPermission = false;
    if (process.platform === "darwin") {
      const { systemPreferences } = require("electron");
      try {
        hasPermission = systemPreferences.getMediaAccessStatus("screen") === "granted";
      } catch (_) {
        hasPermission = false;
      }
    } else {
      hasPermission = true;
    }
    const result = await activeWin({ screenRecordingPermission: hasPermission });
    const activity = normalize(result);
    if (activity.appName !== "Unknown" || activity.windowTitle || activity.pid) {
      lastKnownActivity = activity;
    }
    return activity;
  } catch (_err) {
    return lastKnownActivity || normalize(null);
  }
}

module.exports = { collectActivity };
