"use strict";

const os = require("os");
const si = require("systeminformation");

let previousStats = null;
let cachedLocation = "Unknown";
let cachedWifi = "";
let lastLocalIp = "";
let lastWifiFetchTime = 0;
let isFetchingLocation = false;
const WIFI_CACHE_TTL = 10000; // Cache SSID for 10 seconds

async function fetchLocationFromIp() {
  if (isFetchingLocation) return;
  isFetchingLocation = true;
  try {
    const res = await fetch("http://ip-api.com/json", {
      signal: AbortSignal.timeout(5000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.status === "success") {
        const city = data.city || "";
        const region = data.regionName || data.region || "";
        const country = data.country || "";
        const parts = [city, region, country].filter(Boolean);
        if (parts.length > 0) {
          cachedLocation = parts.join(", ");
        }
      }
    }
  } catch (err) {
    // Ignore error and keep cached value
  } finally {
    isFetchingLocation = false;
  }
}

async function fetchWifiSsid() {
  const now = Date.now();
  if (now - lastWifiFetchTime < WIFI_CACHE_TTL) {
    return cachedWifi;
  }

  // Method 1: systeminformation (works if Location Services is enabled)
  try {
    const connections = await si.wifiConnections();
    if (connections && connections.length > 0) {
      const active = connections.find(c => c.ssid);
      if (active && active.ssid) {
        cachedWifi = active.ssid;
        lastWifiFetchTime = now;
        return cachedWifi;
      }
    }
  } catch (err) {
    // Fall through to platform-specific fallback
  }

  // Method 2: macOS native airport CLI (does NOT need Location Services permission)
  if (os.platform() === "darwin") {
    try {
      const { execSync } = require("child_process");
      const output = execSync(
        "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I",
        { timeout: 3000, encoding: "utf8" }
      );
      const match = output.match(/\s+SSID:\s+(.+)/);
      if (match && match[1].trim()) {
        cachedWifi = match[1].trim();
        lastWifiFetchTime = now;
        return cachedWifi;
      }
    } catch (_) {
      // airport not available or failed
    }

    // Method 3: macOS networksetup CLI fallback (works on Sonoma/Sequoia without Location Services)
    try {
      const { execSync } = require("child_process");
      // Find wifi interface (default to en0)
      let wifiIface = "en0";
      try {
        const portsOut = execSync("networksetup -listallhardwareports", { timeout: 2000, encoding: "utf8" });
        const lines = portsOut.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes("Wi-Fi") || lines[i].includes("AirPort")) {
            const nextLine = lines[i + 1];
            if (nextLine && nextLine.includes("Device:")) {
              const devMatch = nextLine.match(/Device:\s+(\S+)/);
              if (devMatch) {
                wifiIface = devMatch[1];
                break;
              }
            }
          }
        }
      } catch (_) {
        // use default en0
      }

      const output = execSync(`networksetup -getairportnetwork ${wifiIface}`, { timeout: 3000, encoding: "utf8" });
      const match = output.match(/Current Wi-Fi Network:\s+(.+)/);
      if (match && match[1].trim()) {
        cachedWifi = match[1].trim();
        lastWifiFetchTime = now;
        return cachedWifi;
      }
    } catch (_) {
      // networksetup failed
    }
  }

  cachedWifi = "";
  lastWifiFetchTime = now;
  return cachedWifi;
}

function round(value, digits = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function findPrimaryInterface() {
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const item of entries || []) {
      if (item && item.family === "IPv4" && !item.internal) {
        return {
          localIp: item.address || "",
          macAddress: item.mac || "",
          iface: item.name || "",
        };
      }
    }
  }
  return { localIp: "", macAddress: "", iface: "" };
}

async function collectNetwork() {
  const primary = findPrimaryInterface();
  let uploadKBps = 0;
  let downloadKBps = 0;

  if (primary.localIp && primary.localIp !== lastLocalIp) {
    lastLocalIp = primary.localIp;
    fetchLocationFromIp(); // Fetch asynchronously, do not await to avoid blocking tick
  }

  const wifi = await fetchWifiSsid();

  try {
    const stats = await si.networkStats(primary.iface || "*");
    const current = Array.isArray(stats) ? stats[0] : stats;
    if (current) {
      if (Number.isFinite(Number(current.tx_sec)) || Number.isFinite(Number(current.rx_sec))) {
        uploadKBps = Number(current.tx_sec) / 1024;
        downloadKBps = Number(current.rx_sec) / 1024;
      } else if (previousStats?.timestamp) {
        const elapsedSeconds = Math.max(1, (Date.now() - previousStats.timestamp) / 1000);
        uploadKBps = (Number(current.tx_bytes || 0) - previousStats.txBytes) / elapsedSeconds / 1024;
        downloadKBps = (Number(current.rx_bytes || 0) - previousStats.rxBytes) / elapsedSeconds / 1024;
      }
      previousStats = {
        timestamp: Date.now(),
        txBytes: Number(current.tx_bytes || 0),
        rxBytes: Number(current.rx_bytes || 0),
      };
    }
  } catch (_) {
    uploadKBps = 0;
    downloadKBps = 0;
  }

  return {
    ...primary,
    wifi,
    location: cachedLocation,
    uploadKBps: Math.max(0, round(uploadKBps, 1)),
    downloadKBps: Math.max(0, round(downloadKBps, 1)),
  };
}

module.exports = { collectNetwork };
