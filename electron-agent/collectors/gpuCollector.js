"use strict";

const si = require("systeminformation");

async function collectGpu() {
  const graphics = await si.graphics();
  const controller = Array.isArray(graphics?.controllers) ? graphics.controllers[0] : null;
  return {
    vendor: controller?.vendor || "",
    model: controller?.model || "",
    vramMB: Math.max(0, Math.round(Number(controller?.vram) || 0)),
  };
}

module.exports = { collectGpu };
