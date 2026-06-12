"use strict";

const si = require("systeminformation");
const { exec } = require("child_process");
const os = require("os");

function execAsync(cmd) {
  return new Promise((resolve) => {
    exec(cmd, (err, stdout) => {
      if (err) resolve("");
      else resolve(stdout);
    });
  });
}

async function collectGpu() {
  const graphics = await si.graphics();
  const controller = Array.isArray(graphics?.controllers) ? graphics.controllers[0] : null;
  return {
    vendor: controller?.vendor || "",
    model: controller?.model || "",
    vramMB: Math.max(0, Math.round(Number(controller?.vram) || 0)),
  };
}

async function collectGpuUsage() {
  const platform = os.platform();
  if (platform === "win32") {
    try {
      const cmd = `powershell -Command "(((Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples | where CookedValue).CookedValue | measure -sum).sum"`;
      const stdout = await execAsync(cmd);
      const val = parseFloat(stdout.trim());
      return isNaN(val) ? 0 : Math.round(val * 10) / 10;
    } catch (err) {
      return 0;
    }
  } else if (platform === "darwin") {
    // Method 1: Query Apple Silicon AGX / AMD / Intel GPU accelerators via IOKit classes
    try {
      let stdout = await execAsync("ioreg -r -c AGXAccelerator");
      if (!stdout) {
        stdout = await execAsync("ioreg -r -c IOAccelerator");
      }
      if (!stdout) {
        stdout = await execAsync("ioreg -r -c IOGPU");
      }

      if (stdout) {
        // "Device Utilization %" = N (most common on Apple Silicon and discrete GPUs)
        const match = stdout.match(/"Device Utilization %"\s*=\s*(\d+)/);
        if (match) {
          return parseInt(match[1], 10);
        }
        // Fallback keys for utilization or busy percentage
        const appleMatch = stdout.match(/"(?:gpu-utilization|Busy\s*%)"\s*=\s*(\d+)/i);
        if (appleMatch) {
          return parseInt(appleMatch[1], 10);
        }
      }
    } catch (err) {
      // ignore and return 0
    }

    return 0;
  }
  return 0;
}

module.exports = { collectGpu, collectGpuUsage };
