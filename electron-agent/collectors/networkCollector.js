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

const fs = require("fs");
const path = require("path");

let wifiNative = null;
let wifiNativeError = null;
let wifiNativePath = "";
let wifiNativeExists = false;

try {
  // Resolve the path to the compiled .node file
  wifiNativePath = require.resolve("wifi-native/build/Release/wifi_native.node");
  
  // If it's resolved inside app.asar, use the app.asar.unpacked path which is the real file on disk
  if (wifiNativePath.includes("app.asar") && !wifiNativePath.includes("app.asar.unpacked")) {
    const unpacked = wifiNativePath.replace("app.asar", "app.asar.unpacked");
    if (fs.existsSync(unpacked)) {
      wifiNativePath = unpacked;
    }
  }
  wifiNativeExists = fs.existsSync(wifiNativePath);
} catch (err) {
  wifiNativeError = err;
}

// 5. Print startup logs
console.log("Addon path:", wifiNativePath);
console.log("Exists:", wifiNativeExists);

function loadNativeAddon() {
  try {
    const nativePkg = require("wifi-native");
    wifiNative = nativePkg;
    wifiNativeError = nativePkg.loadError || null;
    return wifiNative;
  } catch (err) {
    wifiNativeError = err;
    if (os.platform() === "darwin") {
      console.error("[NetworkCollector] Native CoreWLAN addon failed to load. Full error:", err);
    }
    return null;
  }
}

// Initial load of the native module
loadNativeAddon();

/**
 * Attempt to read the SSID via macOS CoreWLAN framework using osascript Objective-C bridge.
 * This method inherits the parent Electron app's Location Services entitlement,
 * which is why it can return the real SSID when CLI tools return <redacted>.
 * Returns the SSID string or null if it fails.
 */
function fetchSsidViaCoreWLAN() {
  if (os.platform() !== "darwin") return null;
  try {
    const { execSync } = require("child_process");
    const script = [
      "ObjC.import('CoreWLAN');",
      "var client = $.CWWiFiClient.sharedWiFiClient;",
      "var iface = client.interface;",
      "if (iface && iface.ssid) { iface.ssid.js; } else { ''; }"
    ].join(" ");
    const result = execSync(`osascript -l JavaScript -e "${script}"`, {
      timeout: 3000,
      encoding: "utf8",
      env: { ...process.env },
    }).trim();
    if (result && result !== "" && result !== "<redacted>") {
      return result;
    }
  } catch (_) {
    // CoreWLAN JXA method failed — try Objective-C bridge
  }

  // Fallback: Objective-C bridge (more compatible with older macOS)
  try {
    const { execSync } = require("child_process");
    const objcScript = `
      ObjC.import('CoreWLAN');
      var client = $.CWWiFiClient.sharedWiFiClient;
      var iface = client.interface;
      if (iface) {
        var ssid = iface.ssid;
        if (ssid) { ssid.js; } else { ''; }
      } else { ''; }
    `.trim().replace(/\n/g, " ");
    const result = execSync(`osascript -l JavaScript -e "${objcScript}"`, {
      timeout: 3000,
      encoding: "utf8",
      env: { ...process.env },
    }).trim();
    if (result && result !== "" && result !== "<redacted>") {
      return result;
    }
  } catch (_) {
    // Objective-C bridge also failed
  }

  return null;
}

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

  // Method 0: Native in-process CoreWLAN addon (most reliable on macOS Sonoma/Sequoia/Tahoe)
  if (os.platform() === "darwin") {
    try {
      if (!wifiNative && wifiNativeError) {
        loadNativeAddon(); // Retry in case of deferred loading
      }
      if (wifiNative && typeof wifiNative.getSSID === "function") {
        const nativeSsid = wifiNative.getSSID();
        if (nativeSsid !== null && nativeSsid !== undefined && nativeSsid !== "<redacted>") {
          cachedWifi = nativeSsid;
          lastWifiFetchTime = now;
          return cachedWifi;
        }
      }
    } catch (err) {
      console.error("[NetworkCollector] Native addon getSSID call failed:", err);
    }
  }

  // Method 0.5 (macOS only): CoreWLAN via Objective-C bridge — fallback
  // This inherits the Electron app's Location Services entitlement
  const coreWlanSsid = fetchSsidViaCoreWLAN();
  if (coreWlanSsid) {
    cachedWifi = coreWlanSsid;
    lastWifiFetchTime = now;
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

  // macOS specific fallbacks
  if (os.platform() === "darwin") {
    const { execSync } = require("child_process");

    // Helper to resolve the correct Wi-Fi interface (e.g. en0)
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
      // Default to en0 if listallhardwareports fails
    }

    // Fallback 1: system_profiler (very reliable on Ventura/Sonoma/Sequoia without Location Services)
    try {
      const output = execSync("system_profiler SPAirPortDataType", { timeout: 3000, encoding: "utf8" });
      const lines = output.split("\n");
      let inInterfaceBlock = false;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        
        const isInterfaceHeader = line.match(/^\s{8}[a-zA-Z0-9]+:$/);
        if (isInterfaceHeader) {
          if (trimmed === `${wifiIface}:`) {
            inInterfaceBlock = true;
          } else {
            inInterfaceBlock = false;
          }
          continue;
        }
        
        if (inInterfaceBlock) {
          if (line.includes("Current Network Information:")) {
            const nextLine = lines[i + 1];
            if (nextLine && nextLine.trim()) {
              const ssid = nextLine.replace(/:$/, "").trim();
              if (ssid) {
                cachedWifi = ssid;
                lastWifiFetchTime = now;
                return cachedWifi;
              }
            }
          }
        }
      }
    } catch (_) {
      // system_profiler failed
    }

    // Fallback 2: networksetup -getairportnetwork
    try {
      const output = execSync(`networksetup -getairportnetwork ${wifiIface}`, { timeout: 3000, encoding: "utf8" });
      const match = output.match(/Current Wi-Fi Network:\s+(.+)/);
      if (match && match[1].trim() && match[1].trim() !== "<redacted>") {
        cachedWifi = match[1].trim();
        lastWifiFetchTime = now;
        return cachedWifi;
      }
    } catch (_) {
      // networksetup failed
    }

    // Fallback 3: ipconfig getsummary
    try {
      const output = execSync(`ipconfig getsummary ${wifiIface}`, { timeout: 3000, encoding: "utf8" });
      const match = output.match(/\s*SSID\s*:\s*(.+)/);
      if (match && match[1].trim() && match[1].trim() !== "<redacted>") {
        cachedWifi = match[1].trim();
        lastWifiFetchTime = now;
        return cachedWifi;
      }
    } catch (_) {
      // ipconfig failed
    }

    // Fallback 4: airport -I (legacy, for older macOS versions)
    try {
      const output = execSync(
        "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I",
        { timeout: 3000, encoding: "utf8" }
      );
      const match = output.match(/\s+SSID:\s+(.+)/);
      if (match && match[1].trim() && match[1].trim() !== "<redacted>") {
        cachedWifi = match[1].trim();
        lastWifiFetchTime = now;
        return cachedWifi;
      }
    } catch (_) {
      // airport failed
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
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const item of entries || []) {
      if (item && item.family === "IPv4" && !item.internal) {
        return {
          localIp: item.address || "",
          macAddress: item.mac || "",
          iface: name || "",
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

  let wifi = await fetchWifiSsid();

  // macOS fallback for redacted Wi-Fi SSID
  if (os.platform() === "darwin" && (!wifi || wifi === "<redacted>" || wifi.toLowerCase() === "redacted")) {
    let isWifiIface = false;
    try {
      const { execSync } = require("child_process");
      const portsOut = execSync("networksetup -listallhardwareports", { timeout: 2000, encoding: "utf8" });
      const lines = portsOut.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes("Wi-Fi") || lines[i].includes("AirPort")) {
          const nextLine = lines[i + 1];
          if (nextLine && nextLine.includes("Device:")) {
            const devMatch = nextLine.match(/Device:\s+(\S+)/);
            if (devMatch && primary.iface === devMatch[1]) {
              isWifiIface = true;
              break;
            }
          }
        }
      }
    } catch (_) {}
    
    if (isWifiIface) {
      wifi = "Wi-Fi";
    }
  }

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

module.exports = { collectNetwork, wifiNative, wifiNativeError, loadNativeAddon, wifiNativePath, wifiNativeExists };
