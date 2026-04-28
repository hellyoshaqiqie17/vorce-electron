"use strict";

/**
 * Idle tracking.
 *
 * The spec lists `desktop-idle` as a reference dependency, but that package
 * is unmaintained and ships native bindings that frequently fail to compile
 * on modern Windows toolchains. We use Electron's built-in
 * `powerMonitor.getSystemIdleTime()` instead — same OS-level signal, no
 * native build step. Drop-in swap is trivial if you'd rather use the
 * original library.
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
