"use strict";

const si = require("systeminformation");

async function collectBattery() {
  const battery = await si.battery();
  return {
    hasBattery: Boolean(battery?.hasBattery),
    percent: Math.max(0, Math.min(100, Math.round(Number(battery?.percent) || 0))),
    charging: Boolean(battery?.isCharging || battery?.acConnected),
  };
}

module.exports = { collectBattery };
