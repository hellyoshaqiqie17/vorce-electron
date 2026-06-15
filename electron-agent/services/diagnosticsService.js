"use strict";

const os = require("os");
const path = require("path");
const fs = require("fs");
const { exec, execSync } = require("child_process");
const { app, systemPreferences } = require("electron");

// circular log import
const logger = require("../utils/logger");

// Diagnostic In-Memory State
const collectorsState = {
  deviceInfo: { count: 0, successes: 0, failures: 0, totalDurationMs: 0, lastRun: null, durationMs: 0, lastError: null, lastSuccess: null, lastFailure: null },
  activity: { count: 0, successes: 0, failures: 0, totalDurationMs: 0, lastRun: null, durationMs: 0, lastError: null, lastSuccess: null, lastFailure: null },
  network: { count: 0, successes: 0, failures: 0, totalDurationMs: 0, lastRun: null, durationMs: 0, lastError: null, lastSuccess: null, lastFailure: null },
  cpu: { count: 0, successes: 0, failures: 0, totalDurationMs: 0, lastRun: null, durationMs: 0, lastError: null, lastSuccess: null, lastFailure: null },
  ram: { count: 0, successes: 0, failures: 0, totalDurationMs: 0, lastRun: null, durationMs: 0, lastError: null, lastSuccess: null, lastFailure: null },
  disk: { count: 0, successes: 0, failures: 0, totalDurationMs: 0, lastRun: null, durationMs: 0, lastError: null, lastSuccess: null, lastFailure: null },
  gpu: { count: 0, successes: 0, failures: 0, totalDurationMs: 0, lastRun: null, durationMs: 0, lastError: null, lastSuccess: null, lastFailure: null },
  idle: { count: 0, successes: 0, failures: 0, totalDurationMs: 0, lastRun: null, durationMs: 0, lastError: null, lastSuccess: null, lastFailure: null },
  session: { count: 0, successes: 0, failures: 0, totalDurationMs: 0, lastRun: null, durationMs: 0, lastError: null, lastSuccess: null, lastFailure: null },
  application: { count: 0, successes: 0, failures: 0, totalDurationMs: 0, lastRun: null, durationMs: 0, lastError: null, lastSuccess: null, lastFailure: null },
  activeWindow: { count: 0, successes: 0, failures: 0, totalDurationMs: 0, lastRun: null, durationMs: 0, lastError: null, lastSuccess: null, lastFailure: null },
  presence: { count: 0, successes: 0, failures: 0, totalDurationMs: 0, lastRun: null, durationMs: 0, lastError: null, lastSuccess: null, lastFailure: null },
};

const pipelineState = {
  sample: { stage: "sample", status: "healthy", lastProcessed: "", lastError: "" },
  intelligence: { stage: "intelligence", status: "healthy", lastProcessed: "", lastError: "" },
  presence: { stage: "presence", status: "healthy", lastProcessed: "", lastError: "" },
  session: { stage: "session", status: "healthy", lastProcessed: "", lastError: "" },
  snapshot: { stage: "snapshot", status: "healthy", lastProcessed: "", lastError: "" },
  anomaly: { stage: "anomaly", status: "healthy", lastProcessed: "", lastError: "" },
  "stats summary": { stage: "stats summary", status: "healthy", lastProcessed: "", lastError: "" },
  "daily analytics": { stage: "daily analytics", status: "healthy", lastProcessed: "", lastError: "" },
  "weekly analytics": { stage: "weekly analytics", status: "healthy", lastProcessed: "", lastError: "" },
  "monthly analytics": { stage: "monthly analytics", status: "healthy", lastProcessed: "", lastError: "" },
};

const firestoreWrites = [];
const rtdbWrites = [];

// Presence state variables
let currentPresenceState = "offline";
let currentSessionId = "";
let currentApp = "";
let lastPresenceSent = "";
let lastPresenceAcknowledged = "";
let writeLatencyMs = 0;
let presenceWriteCount = 0;
let presenceFailureCount = 0;

// RTDB & Firestore connections
let rtdbConnected = false;
let firestoreConnected = true;
let lastFirestoreError = "";
let lastRtdbError = "";

// Wifi state
let cachedWifiSsid = "";
let cachedWifiBssid = "";
let cachedWifiIface = "";
let cachedWifiError = "";
let wifiCollectorStatus = "healthy";

function recordCollector(name, durationMs, success, error = null) {
  const c = collectorsState[name];
  if (!c) return;
  const now = new Date().toISOString();
  c.count++;
  c.lastRun = now;
  c.durationMs = durationMs;
  c.totalDurationMs += durationMs;
  if (success) {
    c.successes++;
    c.lastSuccess = now;
  } else {
    c.failures++;
    c.lastFailure = now;
    c.lastError = error ? String(error) : "Unknown error";
  }
}

function recordFirestoreWrite(collection, success, error = null) {
  firestoreConnected = success;
  if (!success && error) {
    lastFirestoreError = String(error.message || error);
  }
  firestoreWrites.unshift({
    collection,
    timestamp: new Date().toISOString(),
    success,
    error: error ? String(error.message || error) : ""
  });
  if (firestoreWrites.length > 50) firestoreWrites.pop();
}

function recordRtdbWrite(path, success, error = null) {
  rtdbConnected = success;
  if (!success && error) {
    lastRtdbError = String(error.message || error);
  }
  rtdbWrites.unshift({
    path,
    lastWrite: new Date().toISOString(),
    success,
    error: error ? String(error.message || error) : ""
  });
  if (rtdbWrites.length > 50) rtdbWrites.pop();
}

function recordPipelineStage(stage, success, error = null) {
  const p = pipelineState[stage];
  if (!p) return;
  p.lastProcessed = new Date().toISOString();
  if (success) {
    p.status = "healthy";
    p.lastError = "";
  } else {
    p.status = "error";
    p.lastError = error ? String(error.message || error) : "Pipeline error";
  }
}

function recordPresenceWrite(success, latency, payload, error = null) {
  const now = new Date().toISOString();
  lastPresenceSent = now;
  presenceWriteCount++;
  writeLatencyMs = latency;
  
  if (success) {
    lastPresenceAcknowledged = now;
    rtdbConnected = true;
  } else {
    presenceFailureCount++;
    rtdbConnected = false;
    lastRtdbError = error ? String(error.message || error) : "Write failed";
  }

  if (payload) {
    currentPresenceState = payload.state || "online";
    currentSessionId = payload.sessionId || "";
    currentApp = payload.currentApp || "";
  }
}

// macOS permissions check functions
function checkAccessibility() {
  if (process.platform !== "darwin") return true;
  return systemPreferences.isTrustedAccessibilityClient(false);
}

function checkScreenRecording() {
  if (process.platform !== "darwin") return true;
  try {
    return systemPreferences.getMediaAccessStatus("screen") === "granted";
  } catch (err) {
    return true;
  }
}

function checkAutomation() {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve(true);
      return;
    }
    exec("osascript -e 'tell application \"System Events\" to get name'", { timeout: 2000 }, (err) => {
      resolve(!err);
    });
  });
}

// Full Disk Access (macOS only)
function checkFullDiskAccess() {
  if (process.platform !== "darwin") return true;
  try {
    const safariDir = path.join(os.homedir(), "Library", "Safari");
    fs.readdirSync(safariDir);
    return true;
  } catch (err) {
    return false;
  }
}

// Windows Admin Privileges
function checkAdminPrivileges() {
  if (process.platform !== "win32") return false;
  try {
    execSync("net session", { stdio: "ignore" });
    return true;
  } catch (_) {
    return false;
  }
}

// Wi-Fi commands diagnostics
function getWifiDiagnostics() {
  const result = {
    wifiCollectorStatus: wifiCollectorStatus,
    ssid: cachedWifiSsid || "",
    bssid: cachedWifiBssid || "",
    interface: cachedWifiIface || "en0",
    permissionStatus: "denied",
    isRedacted: false,
    lastError: cachedWifiError,
    rawCollectorOutput: "",
    collectorMethod: "system_profiler SPAirPortDataType",
    macOSVersion: ""
  };

  if (process.platform !== "darwin") {
    result.permissionStatus = "granted";
    if (process.platform === "win32") {
      result.collectorMethod = "netsh wlan show interfaces";
      try {
        const out = execSync("netsh wlan show interfaces", { timeout: 2000, encoding: "utf8" });
        result.rawCollectorOutput = out;
        const ssidMatch = out.match(/^\s*SSID\s*:\s*(.+)$/m);
        const bssidMatch = out.match(/^\s*BSSID\s*:\s*(.+)$/m);
        const interfaceMatch = out.match(/^\s*Name\s*:\s*(.+)$/m);
        if (ssidMatch) result.ssid = ssidMatch[1].trim();
        if (bssidMatch) result.bssid = bssidMatch[1].trim();
        if (interfaceMatch) result.interface = interfaceMatch[1].trim();
      } catch (err) {
        result.wifiCollectorStatus = "error";
        result.lastError = err.message;
      }
    }
    return result;
  }

  // macOS specific checks
  try {
    result.macOSVersion = execSync("sw_vers -productVersion", { timeout: 1000, encoding: "utf8" }).trim();
  } catch (_) {
    result.macOSVersion = os.release();
  }

  // Get active Wi-Fi interface
  let iface = "en0";
  try {
    const portsOut = execSync("networksetup -listallhardwareports", { timeout: 2000, encoding: "utf8" });
    const lines = portsOut.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("Wi-Fi") || lines[i].includes("AirPort")) {
        const nextLine = lines[i + 1];
        if (nextLine && nextLine.includes("Device:")) {
          const devMatch = nextLine.match(/Device:\s+(\S+)/);
          if (devMatch) {
            iface = devMatch[1];
            break;
          }
        }
      }
    }
  } catch (_) {}
  result.interface = iface;

  try {
    const out = execSync("system_profiler SPAirPortDataType", { timeout: 3000, encoding: "utf8" });
    result.rawCollectorOutput = out;
    
    // Parse SSID and BSSID
    const lines = out.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes("Current Network Information:")) {
        const nextLine = lines[i + 1];
        if (nextLine) result.ssid = nextLine.replace(/:$/, "").trim();
      }
      if (lines[i].includes("BSSID:")) {
        result.bssid = lines[i].split("BSSID:")[1].trim();
      }
    }
  } catch (err) {
    result.wifiCollectorStatus = "error";
    result.lastError = err.message;
    result.rawCollectorOutput = `Failed running system_profiler: ${err.message}`;
  }

  if (result.ssid === "<redacted>" || !result.ssid) {
    result.isRedacted = true;
  }

  return result;
}

// Generate the Diagnostics Report
async function getReport(rendererLocationStatus, deviceService, authService, monitor) {
  const accessibility = checkAccessibility();
  const automation = await checkAutomation();
  const screenRecording = checkScreenRecording();
  const locationServices = rendererLocationStatus === true;
  const fullDiskAccess = checkFullDiskAccess();
  const adminPrivileges = checkAdminPrivileges();

  const wifiInfo = getWifiDiagnostics();
  wifiInfo.permissionStatus = locationServices ? "granted" : "denied";

  const regState = deviceService ? deviceService.getRegistrationState() : null;
  const session = authService ? authService.currentSession() : null;
  const monitorRunning = monitor ? monitor.isRunning() : false;

  // Compile Section 1: Agent Status
  const lastHeartbeat = firestoreWrites.find(w => w.collection === "heartbeat")?.timestamp || "";
  const lastStatsUpdate = rtdbWrites.find(w => w.path.includes("stats/"))?.lastWrite || "";
  const lastSnapshot = firestoreWrites.find(w => w.collection === "analytics_snapshots")?.timestamp || "";
  const lastAnalyticsWrite = firestoreWrites.find(w => w.collection.includes("employee_behavior_"))?.timestamp || "";

  const agentStatus = {
    agentVersion: app.getVersion(),
    platform: process.platform,
    osVersion: os.release(),
    deviceId: regState?.deviceId || "",
    userId: session?.userId || "",
    companyId: regState?.binding?.companyId || "",

    agentRunning: true,
    monitorRunning: monitorRunning,
    intelligenceRunning: monitorRunning,

    lastHeartbeat,
    lastPresenceUpdate: lastPresenceAcknowledged || lastPresenceSent,
    lastStatsUpdate,
    lastSnapshot,
    lastAnalyticsWrite
  };

  // Compile Section 2: Collector Diagnostics
  const formattedCollectors = Object.keys(collectorsState).map(key => {
    const c = collectorsState[key];
    const avgMs = c.count > 0 ? Math.round(c.totalDurationMs / c.count) : 0;
    let status = "healthy";
    if (c.failures > 0 && c.successes === 0) {
      status = "error";
    } else if (c.failures > 0) {
      status = "warning";
    }
    return {
      collector: key,
      status,
      lastRun: c.lastRun || "",
      durationMs: c.durationMs,
      averageDurationMs: avgMs,
      lastSuccess: c.lastSuccess || "",
      lastFailure: c.lastFailure || "",
      lastError: c.lastError
    };
  });

  // Section 4: Permissions
  const permissions = process.platform === "darwin" ? {
    accessibility,
    screenRecording,
    locationServices,
    automation,
    fullDiskAccess
  } : {
    adminPrivileges,
    accessibility
  };

  // Section 5: Firebase Diagnostics
  const firebase = {
    authentication: {
      signedIn: !!session?.hasToken,
      uid: session?.userId || "",
      email: session?.email || ""
    },
    firestore: {
      connected: firestoreConnected,
      lastWrite: firestoreWrites[0]?.timestamp || "",
      lastError: lastFirestoreError
    },
    realtimeDatabase: {
      connected: rtdbConnected,
      lastWrite: rtdbWrites[0]?.lastWrite || "",
      lastRead: "", // RTDB is write-mostly from the agent, read only on commands
      lastError: lastRtdbError
    }
  };

  // Section 6: Presence Diagnostics
  const presenceAge = lastPresenceAcknowledged ? Math.round((Date.now() - new Date(lastPresenceAcknowledged).getTime()) / 1000) : 0;
  const presence = {
    presenceState: currentPresenceState,
    sessionId: currentSessionId,
    currentApp: currentApp,
    lastPresenceSent,
    lastPresenceAcknowledged,
    writeLatencyMs,
    heartbeatAgeSeconds: Math.max(0, presenceAge),
    presenceWriteCount,
    presenceFailureCount
  };

  // Section 7: Pipeline Diagnostics
  const pipeline = Object.values(pipelineState);

  return {
    agentStatus,
    collectors: formattedCollectors,
    wifi: wifiInfo,
    permissions,
    firebase,
    presence,
    pipeline,
    recentFirestoreWrites: firestoreWrites.slice(0, 10),
    recentRtdbWrites: rtdbWrites.slice(0, 10),
  };
}

// Startup Audit Sequence
async function runStartupAudit(deviceService, authService, monitor) {
  logger.make("diagnostics").info("Executing dedicated startup diagnostics audit...");
  
  // Set up RTDB connection listener
  try {
    const firebaseClient = require("../firebase/firebaseClient");
    const { ref, onValue } = require("firebase/database");
    const db = firebaseClient.getRealtimeDb();
    const connectedRef = ref(db, ".info/connected");
    onValue(connectedRef, (snap) => {
      rtdbConnected = !!snap.val();
      logger.make("diagnostics").info("RTDB connection state updated", { rtdbConnected });
    });
  } catch (err) {
    logger.make("diagnostics").warn("Could not attach .info/connected listener", { err: err.message });
  }

  // Pre-populate some collector runs
  const startTime = Date.now();
  recordCollector("deviceInfo", 0, true);
  recordCollector("network", 0, true);
  recordCollector("cpu", 0, true);
  recordCollector("ram", 0, true);
  recordCollector("disk", 0, true);
  recordCollector("gpu", 0, true);
  recordCollector("idle", 0, true);
  
  logger.make("diagnostics").info("Startup diagnostics audit sequence complete.");
}

module.exports = {
  recordCollector,
  recordFirestoreWrite,
  recordRtdbWrite,
  recordPipelineStage,
  recordPresenceWrite,
  getReport,
  runStartupAudit
};
