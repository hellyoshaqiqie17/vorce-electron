"use strict";

/**
 * Idle tracking via Electron powerMonitor.
 *
 * The spec references desktop-idle, but we use Electron's built-in
 * powerMonitor.getSystemIdleTime() — same OS-level signal, no native
 * build step, works on Windows / macOS / Linux out of the box.
 */

const { powerMonitor } = require("electron");
const config = require("../core/config");

function getIdle() {
  let seconds = 0;
  try {
    seconds = powerMonitor.getSystemIdleTime();
  } catch (_err) {
    seconds = 0;
  }
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;

  return {
    isIdle: seconds >= config.idleThresholdSeconds,
    seconds,
  };
}

module.exports = { getIdle };
