"use strict";

const { powerMonitor } = require("electron");
const config = require("../core/config");

let desktopIdle = null;
try {
  desktopIdle = require("desktop-idle");
} catch (_) {
  desktopIdle = null;
}

function readIdleSeconds() {
  if (desktopIdle && typeof desktopIdle.getIdleTime === "function") {
    const value = Number(desktopIdle.getIdleTime());
    if (Number.isFinite(value) && value >= 0) {
      return value > 86400 ? Math.round(value / 1000) : Math.round(value);
    }
  }
  return powerMonitor.getSystemIdleTime();
}

function collectIdle() {
  let idleSeconds = 0;
  try {
    idleSeconds = readIdleSeconds();
  } catch (_) {
    idleSeconds = 0;
  }
  if (!Number.isFinite(idleSeconds) || idleSeconds < 0) idleSeconds = 0;

  return {
    isIdle: idleSeconds >= config.idleThresholdSeconds,
    idleSeconds: Math.round(idleSeconds),
  };
}

module.exports = { collectIdle };
