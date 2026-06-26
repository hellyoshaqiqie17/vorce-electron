"use strict";

// Add macOS detection for layout fixes
const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 || navigator.userAgent.includes('Macintosh');
if (isMac) {
  document.body.classList.add("platform-darwin");
}

const api = window.vlinkedAgent;
const $ = (sel) => document.querySelector(sel);

const els = {
  viewLogin: $("#view-login"), viewDashboard: $("#view-dashboard"), btnGoogleLogin: $("#btn-google-login"), loginError: $("#login-error"),
  sessionEmail: $("#session-email"), btnLogout: $("#btn-logout"), btnToggle: $("#btn-toggle"), statusDot: $("#status-dot"), statusText: $("#status-text"), syncMode: $("#sync-mode"),
  syncStatus: $("#sync-status"), companyName: $("#company-name"), deviceCount: $("#device-count"), lastSync: $("#last-sync"), deviceIdCompact: $("#device-id-compact"), healthScore: $("#health-score"),
  kpiCpu: $("#kpi-cpu"), kpiRam: $("#kpi-ram"), kpiSessions: $("#kpi-sessions"), kpiProcesses: $("#kpi-processes"), kpiNetwork: $("#kpi-network"), kpiHealth: $("#kpi-health"),
  kpiCpuTrend: $("#kpi-cpu-trend"), kpiRamTrend: $("#kpi-ram-trend"), kpiSwitching: $("#kpi-switching"), kpiNetworkQuality: $("#kpi-network-quality"), kpiHealthTrend: $("#kpi-health-trend"),
  cpuNow: $("#cpu-now"), cpuPeak: $("#cpu-peak"), cpuAvg: $("#cpu-avg"), chartCpu: $("#chart-cpu"), chartNetwork: $("#chart-network"), donutRam: $("#donut-ram"), ramNow: $("#ram-now"), ramDetail: $("#ram-detail"), memoryPressure: $("#memory-pressure"),
  storageFill: $("#storage-fill"), storageUsed: $("#storage-used"), storageFree: $("#storage-free"), storageStatus: $("#storage-status"), netUp: $("#net-up"), netDown: $("#net-down"),
  topRamApps: $("#top-ram-apps"),
  appCategory: $("#app-category"), appAvatar: $("#app-avatar"), activeApp: $("#active-app"), activeTitle: $("#active-title"), activeExecutable: $("#active-executable"), activeDuration: $("#active-duration"), focusTimeline: $("#focus-timeline"), usageBreakdown: $("#usage-breakdown"), sessionTable: $("#session-table"),
  activeIdleRatio: $("#active-idle-ratio"), switchFrequency: $("#switch-frequency"), memorySpikes: $("#memory-spikes"), anomalyState: $("#anomaly-state"),
  specCpu: $("#spec-cpu"), specRam: $("#spec-ram"), specGpu: $("#spec-gpu"), specSsd: $("#spec-ssd"), specIp: $("#spec-ip"), specMac: $("#spec-mac"),
  donutGpu: $("#donut-gpu"), gpuNow: $("#gpu-now"), gpuDetail: $("#gpu-detail"), gpuStatus: $("#gpu-status"),
  navItems: document.querySelectorAll(".nav-item"), pageDashboard: $("#page-dashboard"), routeContent: $("#route-content"), pageTitle: $("#page-title"), pageEyebrow: $("#page-eyebrow"),
  versionInfo: $("#version-info"), versionText: $("#version-text"), updateStatusText: $("#update-status-text"),
};

let running = false;
let sessionInfo = null;
let currentRoute = "dashboard";
let lastSample = null;
let currentVersion = "—";
let currentUpdateState = { status: "idle" };
let updateDeferred = false;

const analytics = {
  samples: [],
  cpu: [], ram: [], net: [], health: [],
  appDurations: new Map(),
  appMemory: new Map(),
  browserTabs: new Map(),
  sessionMap: new Map(),
  sessions: [],
  current: null,
  memorySpikes: 0,
  activeSeconds: 0,
  idleSeconds: 0,
  switches: 0,
};

function setText(el, value) { if (el) el.textContent = value; }
function pct(v) { return Number.isFinite(Number(v)) ? `${Math.round(Number(v))}%` : "—"; }
function gb(v) { return Number.isFinite(Number(v)) ? `${Number(v).toFixed(1)} GB` : "—"; }
function kb(v) { const n = Number(v) || 0; return n >= 1024 ? `${(n / 1024).toFixed(1)} MB/s` : `${Math.round(n)} KB/s`; }
function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
function time(ts) { return new Date((ts || Date.now() / 1000) * 1000).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); }
function duration(sec) { const s = Math.max(0, Math.round(sec || 0)); const m = Math.floor(s / 60); const r = s % 60; return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`; }
function appKey(app) {
  const appName = String(app.appName || app.name || "Unknown").trim();
  const title = String(app.windowTitle || app.title || "").trim();
  const executable = String(app.executable || "").trim();
  const normalized = `${appName} ${executable}`.toLowerCase();
  const isBrowser = /chrome|firefox|edge|brave|opera|safari/.test(normalized);
  return isBrowser ? `${appName.toLowerCase()}|${title.toLowerCase()}` : appName.toLowerCase();
}
function isBrowserApp(name, executable = "") {
  return /chrome|firefox|edge|brave|opera|safari/.test(`${name || ""} ${executable || ""}`.toLowerCase());
}
function browserTabLabel(title) {
  return String(title || "Untitled tab")
    .replace(/\s+-\s+Microsoft Edge$/i, "")
    .replace(/\s+-\s+Google Chrome$/i, "")
    .replace(/\s+-\s+Mozilla Firefox$/i, "")
    .replace(/\s+-\s+Brave$/i, "")
    .replace(/\s+-\s+Opera$/i, "")
    .trim()
    .slice(0, 80) || "Untitled tab";
}
function appNameOf(sample) { const app = sample.process || sample.activeApp || {}; return app.appName || app.name || "Unknown"; }
function titleOf(sample) { const app = sample.process || sample.activeApp || {}; return app.windowTitle || app.title || ""; }
function executableOf(sample) { return sample.process?.executable || "Executable unavailable"; }
function classifyApp(name, title) {
  const v = `${name} ${title}`.toLowerCase();
  if (/code|visual studio|figma|postman|terminal|powershell/.test(v)) return "Productive Work";
  if (/chrome|edge|firefox|browser|google/.test(v)) return "Browser";
  if (/spotify|music|youtube|netflix/.test(v)) return "Media";
  if (/discord|slack|teams|whatsapp|telegram|linkedin/.test(v)) return "Communication";
  if (/explorer|finder/.test(v)) return "System";
  return "Application";
}
function healthScore(cpu, ram, idle) {
  let score = 100;
  score -= Math.max(0, cpu - 65) * 0.45;
  score -= Math.max(0, ram - 75) * 0.55;
  if (idle?.isIdle) score -= 4;
  return clamp(Math.round(score), 40, 100);
}
function pushLimited(arr, value, max = 48) { arr.push(value); while (arr.length > max) arr.shift(); }

function showLogin() {
  els.viewLogin.hidden = false;
  els.viewDashboard.hidden = true;
  api.invoke("titlebar:set-theme", "login").catch(() => {});
}
function showDashboard(session) {
  sessionInfo = session || sessionInfo;
  els.viewLogin.hidden = true; els.viewDashboard.hidden = false;
  setText(els.sessionEmail, session?.email ? `Masuk sebagai ${session.email}` : "Secure session active");
  setText(els.companyName, session?.companyName || session?.companyId || "Vlinked");
  api.invoke("titlebar:set-theme", "dashboard").catch(() => {});
}
function setStatus(isRunning) {
  running = Boolean(isRunning);
  els.statusDot.classList.toggle("active", running);
  setText(els.statusText, running ? "Live Monitoring" : "Standby");
  setText(els.syncMode, running ? "Telemetry streaming" : "Local analytics ready");
  setText(els.syncStatus, running ? "Online" : "Standby");
  setText(els.btnToggle, running ? "Berhenti Monitoring" : "Mulai Monitoring");
}
function showLoginError(message) { els.loginError.hidden = !message; setText(els.loginError, message || ""); }
function setLoginBusy(busy) { els.btnGoogleLogin.disabled = busy; setText(els.btnGoogleLogin.querySelector(".btn-label"), busy ? "Memproses…" : "Masuk dengan Google"); }

function routeMeta(route) {
  return {
    dashboard: ["Enterprise Device Intelligence Platform", "Live Workforce Telemetry"],
    devices: ["Managed Fleet", "Devices"],
    live: ["Realtime Operations", "Live Monitoring"],
    analytics: ["Performance Intelligence", "Analytics"],
    timeline: ["Focus Intelligence", "Activity Timeline"],
    sessions: ["Workforce Sessions", "Employee Sessions"],
    alerts: ["Operational Risk", "Alerts"],
    settings: ["Agent Controls", "Settings"],
    "agent-diagnostics": ["System Integrity & Auditing", "Agent Diagnostics Center"],
  }[route] || ["Enterprise Device Intelligence Platform", "Dashboard"];
}

function panel(title, subtitle, body) {
  return `<article class="panel route-panel"><div class="panel-head"><div><h2>${title}</h2><p>${subtitle}</p></div></div>${body}</article>`;
}

function metricTile(label, value, tone = "") {
  return `<div class="metric-tile ${tone}"><span>${label}</span><strong>${value}</strong></div>`;
}

function renderRoute(route) {
  const [eyebrow, title] = routeMeta(route);
  setText(els.pageEyebrow, eyebrow);
  setText(els.pageTitle, title);
  els.pageDashboard.classList.toggle("active", route === "dashboard");
  els.routeContent.classList.toggle("active", route !== "dashboard");
  if (route === "dashboard") return;

  const sample = lastSample || {};
  const app = analytics.current || { appName: appNameOf(sample), title: titleOf(sample), duration: 0, category: "Waiting" };
  const cpu = analytics.cpu.at(-1) || 0;
  const ram = analytics.ram.at(-1) || 0;
  const health = analytics.health.at(-1) || 100;
  const sessions = [analytics.current, ...analytics.sessions].filter(Boolean);
  const routeBodies = {
    devices: `
      <section class="route-grid">
        ${panel("Current Device Intelligence", "Live state, heartbeat, focused app, and health posture.", `<div class="device-intel">${metricTile("Device state", running ? "Online" : "Standby", running ? "good" : "")}${metricTile("Health score", health)}${metricTile("CPU source", app.appName || "—")}${metricTile("RAM pressure", pct(ram), ram > 88 ? "bad" : "good")}</div><div class="session-row"><div><strong id="route-device-id">${els.deviceIdCompact.textContent}</strong><span>${sessionInfo?.email || "Authenticated user"}</span></div><strong>${sessionInfo?.companyId || "Company"}</strong></div>`)}
        ${panel("Hardware Specs History", "Timeline of hardware changes detected on this workstation.", `<div id="device-hardware-history" class="signal-list" style="max-height: 280px; overflow-y: auto;"><div class="empty-state compact"><strong>Fetching history...</strong></div></div>`)}
      </section>`,
    live: `
      <section class="route-grid">
        ${panel("Realtime Signal", "Streaming telemetry and heartbeat status.", `<svg id="route-live-chart" class="line-chart" viewBox="0 0 720 220"></svg><div class="split-stats"><span>CPU <b>${pct(cpu)}</b></span><span>RAM <b>${pct(ram)}</b></span><span>Sync <b>${running ? "Live" : "Paused"}</b></span></div>`)}
        ${panel("Current Device Intelligence", "Focused process, duration, executable and anomaly state.", `<div class="activity-main compact"><div class="app-avatar">${(app.appName || "?").slice(0,1)}</div><div class="activity-copy"><span>Focused app</span><strong>${app.appName || "—"}</strong><p>${app.title || "No active title captured"}</p><small>${app.executable || "Executable pending"}</small></div><div class="duration-card"><span>Duration</span><strong>${duration(app.duration)}</strong></div></div>`)}
      </section>`,
    analytics: `
      <section class="route-grid">
        ${panel("Performance Snapshot", "Local analytics before Firestore compression.", `<div class="device-intel">${metricTile("CPU average", pct(avg(analytics.cpu)))}${metricTile("CPU peak", pct(Math.max(...analytics.cpu, 0)))}${metricTile("RAM now", pct(ram), ram > 88 ? "bad" : "")}${metricTile("Memory spikes", analytics.memorySpikes)}</div>`)}
        ${panel("Productivity Graph", "Application switching and active/idle ratio.", `<div class="signal-list"><div><span>Switches</span><strong>${analytics.switches}</strong></div><div><span>Active seconds</span><strong>${duration(analytics.activeSeconds)}</strong></div><div><span>Idle seconds</span><strong>${duration(analytics.idleSeconds)}</strong></div><div><span>Current category</span><strong>${app.category || "—"}</strong></div></div>`)}
      </section>`,
    timeline: `
      <section class="route-grid">
        ${panel("Activity Timeline", "Recent app focus sessions and durations.", `<div class="session-table">${sessions.slice(0, 12).map((s, i) => `<div class="session-row"><div><strong>${s.appName}</strong><span>${s.title || s.category}</span></div><div><time>${i === 0 ? "Active now" : time(s.startedAt)}</time><strong>${duration(s.duration)}</strong></div></div>`).join("") || `<div class="empty-state"><strong>No activity yet</strong><span>Start monitoring to build the timeline.</span></div>`}</div>`)}
        ${panel("Focus Timeline", "Compressed visual focus history.", `<div class="timeline route-timeline">${sessions.slice(0, 18).map((s, i) => { const total = sessions.slice(0,18).reduce((sum,x)=>sum+(x.duration||1),0)||1; const w = Math.max(5, Math.round((s.duration||1)/total*100)); return `<div class="timeline-segment" style="flex:${w};opacity:${1-i*.03}" title="${s.appName} — ${duration(s.duration)}"><span class="tl-label">${s.appName.split('.')[0]}</span></div>`; }).join("")}</div>`)}
      </section>`,
    sessions: `
      <section class="route-grid">
        ${panel("Employee Sessions", "Session rollups generated locally by Electron.", `<div class="device-intel">${metricTile("Open sessions", Math.max(1, sessions.length))}${metricTile("Switches", analytics.switches)}${metricTile("Active ratio", analytics.activeSeconds + analytics.idleSeconds ? `${Math.round(analytics.activeSeconds / (analytics.activeSeconds + analytics.idleSeconds) * 100)}%` : "—")}${metricTile("Current app", app.appName || "—")}</div>`)}
        ${panel("Usage Breakdown", "Application-level focus distribution.", `<div class="usage-list">${els.usageBreakdown.innerHTML || ""}</div>`)}
      </section>`,
    alerts: `
      <section class="route-grid">
        ${panel("Alert Center", "Operational alerts derived from local analytics.", `<div class="alert-list"><div class="alert-item ${ram > 88 ? "bad" : "good"}"><strong>${ram > 88 ? "High memory pressure" : "Memory normal"}</strong><span>${pct(ram)} RAM usage</span></div><div class="alert-item ${cpu > 92 ? "bad" : "good"}"><strong>${cpu > 92 ? "CPU anomaly detected" : "CPU stable"}</strong><span>${pct(cpu)} CPU usage</span></div></div>`)}
        ${panel("Recovery State", "Reconnect and sync posture.", `<div class="empty-state"><strong>${running ? "Telemetry stream healthy" : "Monitoring standby"}</strong><span>${running ? "Heartbeat and local analytics are active." : "Automatic monitoring is starting..."}</span></div>`)}
      </section>`,
    settings: `
      <section class="route-grid">
        ${panel("Agent Settings", "Desktop telemetry controls.", `<div class="settings-list"><label><span>Realtime refresh</span><strong>5s</strong></label><label><span>Firestore write suppression</span><strong>Enabled</strong></label><label><span>Heartbeat</span><strong>Enabled</strong></label><label><span>Window mode</span><strong>Maximized</strong></label></div>`)}
        ${panel("Versi Aplikasi", "Informasi versi dan status pembaruan otomatis.", `<div class="settings-list"><label><span>Versi saat ini</span><strong id="settings-current-version">v${currentVersion}</strong></label><label><span>Status update</span><strong id="settings-update-status">${updateStatusLabel(currentUpdateState)}</strong></label></div><div style="margin-top:14px;display:flex;gap:8px;"><button id="btn-check-update" class="btn primary" style="font-size:12px;padding:8px 16px;">Periksa Pembaruan</button></div>`)}
        ${panel("Sync Queue", "Offline-first desktop state.", `<div class="empty-state"><strong>No pending queue</strong><span>Local analytics are compressed before upload.</span></div>`)}
      </section>`,
    "agent-diagnostics": `
      <div class="diag-actions" style="display: flex; gap: 10px; align-items: center;">
        <button id="btn-export-diagnostics" class="btn primary" style="font-size:13px;padding:10px 20px;">
          <span>📥</span> Generate Diagnostic Report
        </button>
        ${isMac ? `
          <button id="btn-refresh-diagnostics" class="btn primary" style="font-size:13px;padding:10px 20px;background: var(--primary);color: white; border: none;">
            <span>🔄</span> Refresh Report
          </button>
        ` : ''}
      </div>
      <section class="diag-grid">
        <!-- Section 1 — Agent Status -->
        <article class="diag-card" id="card-agent-status">
          <div class="diag-title-row">
            <h3><span>ℹ️</span> Agent Status</h3>
            <span class="status-indicator healthy" id="agent-status-indicator">
              <span class="status-dot-mini"></span>ONLINE
            </span>
          </div>
          <div class="diag-fields" id="fields-agent-status">
          </div>
        </article>

        <!-- Section 3 — WiFi Diagnostics -->
        <article class="diag-card" id="card-wifi-diagnostics">
          <div class="diag-title-row">
            <h3><span>📶</span> WiFi Diagnostics</h3>
            <span class="status-indicator" id="wifi-status-indicator">
              <span class="status-dot-mini"></span>DIAGNOSING
            </span>
          </div>
          <div class="diag-fields" id="fields-wifi-diagnostics">
          </div>
          <div class="rc-box" id="wifi-rc-box" style="display: none;">
            <div class="rc-title">⚠️ Root Cause Analysis</div>
            <ul class="rc-list" id="wifi-rc-list">
            </ul>
          </div>
          <div style="margin-top: 10px;">
            <label style="font-size: 11px; font-weight: 600; color: var(--text-secondary);">Raw Output:</label>
            <div class="pre-output" id="wifi-raw-output">No output collected</div>
          </div>
        </article>

        <!-- Section 4 — Permission Diagnostics -->
        <article class="diag-card" id="card-permissions-diagnostics">
          <div class="diag-title-row">
            <h3><span>🔒</span> Permission Diagnostics</h3>
            <span class="status-indicator" id="permissions-status-indicator">
              <span class="status-dot-mini"></span>CHECKING
            </span>
          </div>
          <div class="diag-fields" id="fields-permissions-diagnostics">
          </div>
        </article>

        <!-- Section 5 — Firebase Diagnostics -->
        <article class="diag-card" id="card-firebase-diagnostics">
          <div class="diag-title-row">
            <h3><span>🔥</span> Firebase Diagnostics</h3>
            <span class="status-indicator" id="firebase-status-indicator">
              <span class="status-dot-mini"></span>CONNECTED
            </span>
          </div>
          <div class="diag-fields" id="fields-firebase-diagnostics">
          </div>
        </article>

        <!-- Section 6 — Presence Diagnostics -->
        <article class="diag-card" id="card-presence-diagnostics">
          <div class="diag-title-row">
            <h3><span>👥</span> Presence Diagnostics</h3>
            <span class="status-indicator" id="presence-status-indicator">
              <span class="status-dot-mini"></span>ACTIVE
            </span>
          </div>
          <div class="diag-fields" id="fields-presence-diagnostics">
          </div>
          <div class="rc-box" id="presence-rc-box" style="display: none;">
            <div class="rc-title">⚠️ Root Cause Analysis</div>
            <ul class="rc-list" id="presence-rc-list">
            </ul>
          </div>
        </article>

        <!-- Section 7 — Intelligence Pipeline Diagnostics -->
        <article class="diag-card" id="card-pipeline-diagnostics" style="grid-column: span 2;">
          <div class="diag-title-row">
            <h3><span>⚙️</span> Intelligence Pipeline Diagnostics</h3>
            <span class="status-indicator" id="pipeline-status-indicator">
              <span class="status-dot-mini"></span>RUNNING
            </span>
          </div>
          <div class="diag-table-container">
            <table class="diag-table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Status</th>
                  <th>Last Processed</th>
                  <th>Last Error</th>
                </tr>
              </thead>
              <tbody id="table-pipeline-diagnostics">
              </tbody>
            </table>
          </div>
        </article>

        <!-- Section 2 — Collector Diagnostics -->
        <article class="diag-card" id="card-collectors-diagnostics" style="grid-column: span 2;">
          <div class="diag-title-row">
            <h3><span>📊</span> Collector Diagnostics</h3>
            <span class="status-indicator" id="collectors-status-indicator">
              <span class="status-dot-mini"></span>HEALTHY
            </span>
          </div>
          <div class="diag-table-container">
            <table class="diag-table">
              <thead>
                <tr>
                  <th>Collector</th>
                  <th>Status</th>
                  <th>Last Run</th>
                  <th>Duration</th>
                  <th>Average</th>
                  <th>Last Error</th>
                </tr>
              </thead>
              <tbody id="table-collectors-diagnostics">
              </tbody>
            </table>
          </div>
        </article>

        <!-- Section 8 — Firestore Write Audit -->
        <article class="diag-card" id="card-firestore-audit">
          <div class="diag-title-row">
            <h3><span>📂</span> Firestore Write Audit</h3>
          </div>
          <div class="diag-table-container">
            <table class="diag-table">
              <thead>
                <tr>
                  <th>Collection</th>
                  <th>Timestamp</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody id="table-firestore-audit">
              </tbody>
            </table>
          </div>
        </article>

        <!-- Section 9 — RTDB Write Audit -->
        <article class="diag-card">
          <div class="diag-title-row">
            <h3><span>⚡</span> RTDB Write Audit</h3>
          </div>
          <div class="diag-table-container">
            <table class="diag-table">
              <thead>
                <tr>
                  <th>Path</th>
                  <th>Last Write</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody id="table-rtdb-audit">
              </tbody>
            </table>
          </div>
        </article>

        <!-- Section 10 — System Log Viewer -->
        <article class="diag-card log-viewer-card">
          <div class="diag-title-row">
            <h3><span>📝</span> System Log Viewer</h3>
          </div>
          <div class="log-viewer-controls">
            <input type="text" class="log-search-input" id="log-search" placeholder="Search message or module..." />
            <div class="log-level-btns">
              <button class="btn-log-lvl active" data-level="ALL">ALL</button>
              <button class="btn-log-lvl" data-level="INFO">INFO</button>
              <button class="btn-log-lvl" data-level="WARN">WARN</button>
              <button class="btn-log-lvl" data-level="ERROR">ERROR</button>
              <button class="btn-log-lvl" data-level="DEBUG">DEBUG</button>
            </div>
          </div>
          <div class="log-list" id="log-list-entries">
          </div>
        </article>
      </section>`,
  };
  if (route === "agent-diagnostics" && els.routeContent.dataset.renderedRoute === "agent-diagnostics") {
    return;
  }
  els.routeContent.innerHTML = routeBodies[route] || routeBodies.dashboard || "";
  els.routeContent.dataset.renderedRoute = route;
  const liveChart = $("#route-live-chart");
  if (liveChart) svgLine(liveChart, analytics.cpu, { width: 720, height: 220, max: 100 });

  if (route === "devices") {
    api.invoke("device:get-history").then(res => {
      const listEl = $("#device-hardware-history");
      if (!listEl) return;
      if (!res.ok || !res.data) {
        listEl.innerHTML = `<div class="empty-state compact"><strong>Gagal mengambil histori</strong><span>${res.error || ""}</span></div>`;
        return;
      }
      const { cpuHistory = [], ramHistory = [], gpuHistory = [], ssdHistory = [] } = res.data;
      const allHistory = [];
      cpuHistory.forEach(h => allHistory.push({ type: "CPU", ...h }));
      ramHistory.forEach(h => allHistory.push({ type: "RAM", ...h }));
      gpuHistory.forEach(h => allHistory.push({ type: "GPU", ...h }));
      ssdHistory.forEach(h => allHistory.push({ type: "SSD/Disk", ...h }));

      allHistory.sort((a, b) => {
        const tA = a.timestamp?.seconds ? a.timestamp.seconds * 1000 : new Date(a.timestamp).getTime();
        const tB = b.timestamp?.seconds ? b.timestamp.seconds * 1000 : new Date(b.timestamp).getTime();
        return tB - tA;
      });

      if (allHistory.length === 0) {
        listEl.innerHTML = `<div class="empty-state compact"><strong>No changes detected</strong><span>Hardware remains unchanged since registration.</span></div>`;
        return;
      }

      listEl.innerHTML = allHistory.map(h => {
        let dateStr = "Unknown Date";
        if (h.timestamp) {
          const ms = h.timestamp.seconds ? h.timestamp.seconds * 1000 : new Date(h.timestamp).getTime();
          dateStr = new Date(ms).toLocaleString("id-ID");
        }
        return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-radius: 8px; background: var(--surface-alt); margin-bottom: 8px;">
          <div>
            <strong style="color: var(--primary); font-size: 11px; text-transform: uppercase; display: block; margin-bottom: 2px;">${h.type}</strong>
            <span style="font-size: 13px; color: var(--text); font-weight: 500;">${h.value}</span>
          </div>
          <small style="color: var(--text-tertiary); font-size: 11px;">${dateStr}</small>
        </div>`;
      }).join("");
    }).catch(err => {
      const listEl = $("#device-hardware-history");
      if (listEl) {
        listEl.innerHTML = `<div class="empty-state compact"><strong>Gagal mengambil histori</strong><span>${err.message || ""}</span></div>`;
      }
    });
  }
}

function switchRoute(route) {
  currentRoute = route || "dashboard";
  els.navItems.forEach((item) => item.classList.toggle("active", item.dataset.route === currentRoute));
  renderRoute(currentRoute);

  if (route === "agent-diagnostics") {
    startDiagnosticsPolling();
    bindDiagnosticsEvents();
  } else {
    stopDiagnosticsPolling();
  }

  // Bind check update button if on settings page
  if (route === "settings") {
    const btnCheck = $("#btn-check-update");
    if (btnCheck) {
      btnCheck.addEventListener("click", async () => {
        updateDeferred = false;
        btnCheck.disabled = true;
        btnCheck.textContent = "Memeriksa...";
        const res = await api.invoke("app:check-update");
        if (!res.ok) {
          btnCheck.textContent = "Periksa Pembaruan";
          btnCheck.disabled = false;
          const statusEl = $("#settings-update-status");
          if (statusEl) setText(statusEl, res.error || "Gagal memeriksa");
        }
        // If successful, status will be updated via update:status event
        setTimeout(() => { btnCheck.disabled = false; btnCheck.textContent = "Periksa Pembaruan"; }, 5000);
      });
    }
  }
}

function svgLine(el, values, opts = {}) {
  if (!el) return;
  const width = opts.width || 720, height = opts.height || 220, pad = opts.pad || 18;
  const data = values.length ? values : [0];
  const max = Math.max(opts.max || 100, ...data, 1), min = opts.min || 0;
  const points = data.map((v, i) => {
    const x = pad + 28 + (i / Math.max(1, data.length - 1)) * (width - pad * 2 - 28);
    const y = height - pad - ((v - min) / Math.max(1, max - min)) * (height - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = `${pad + 28},${height - pad} ${points.join(" ")} ${width - pad},${height - pad}`;
  const yLabels = [0, .25, .5, .75, 1].map(p => {
    const val = Math.round(max - p * (max - min));
    const y = pad + p * (height - pad * 2);
    return `<text x="${pad + 20}" y="${y + 4}" text-anchor="end" class="chart-label">${val}%</text>`;
  }).join("");
  const gridLines = [.25, .5, .75].map(p => `<line class="chart-grid" x1="${pad + 28}" x2="${width - pad}" y1="${pad + p * (height - pad * 2)}" y2="${pad + p * (height - pad * 2)}"/>`).join("");
  const lastVal = data[data.length - 1];
  const lastY = height - pad - ((lastVal - min) / Math.max(1, max - min)) * (height - pad * 2);
  const currentLabel = `<circle cx="${width - pad}" cy="${lastY}" r="4" fill="var(--primary, #5A30FF)"/><text x="${width - pad + 8}" y="${lastY + 4}" class="chart-label-current">${Math.round(lastVal)}%</text>`;
  el.innerHTML = `<defs><linearGradient id="lineGradient" x1="0" x2="1"><stop offset="0%" stop-color="#5A30FF"/><stop offset="100%" stop-color="#8b6aff"/></linearGradient><linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#5A30FF" stop-opacity=".12"/><stop offset="100%" stop-color="#5A30FF" stop-opacity="0"/></linearGradient></defs><path class="chart-area" d="M ${area} Z"/><path class="chart-line" d="M ${points.join(" L ")}"/><g>${gridLines}</g><g>${yLabels}</g>${currentLabel}`;
}
function spark(id, values) { svgLine($(id), values, { width: 120, height: 36, pad: 3, max: 100 }); }
function donut(el, value) {
  const r = 58, c = 2 * Math.PI * r, v = clamp(Number(value) || 0, 0, 100);
  el.innerHTML = `<circle cx="80" cy="80" r="${r}" fill="none" stroke="rgba(148,163,184,.16)" stroke-width="16"/><circle cx="80" cy="80" r="${r}" fill="none" stroke="url(#donutGrad)" stroke-width="16" stroke-linecap="round" stroke-dasharray="${(v/100)*c} ${c}" transform="rotate(-90 80 80)"/><defs><linearGradient id="donutGrad"><stop offset="0%" stop-color="#22d3ee"/><stop offset="100%" stop-color="#a78bfa"/></linearGradient></defs>`;
}

function updateAnalytics(sample) {
  const ts = Number(sample.timestamp) || Math.floor(Date.now() / 1000);
  const cpu = Number(sample.cpu?.usagePercent ?? sample.cpuUsage) || 0;
  const ram = Number(sample.ram?.usagePercent ?? sample.ramUsage) || 0;
  const netTotal = (Number(sample.network?.uploadKBps) || 0) + (Number(sample.network?.downloadKBps) || 0);
  const appName = appNameOf(sample), title = titleOf(sample), key = appKey(sample.process || sample.activeApp || {});
  const previous = analytics.samples[analytics.samples.length - 1];
  const delta = previous ? Math.max(1, ts - previous.timestamp) : 5;
  if (sample.idle?.isIdle) analytics.idleSeconds += delta; else analytics.activeSeconds += delta;
  if (!sample.idle?.isIdle && sample.process?.memoryMB) {
    const memoryMB = Number(sample.process.memoryMB) || 0;
    const currentMemory = analytics.appMemory.get(appName) || { peakMB: 0, latestMB: 0, samples: 0 };
    analytics.appMemory.set(appName, {
      peakMB: Math.max(currentMemory.peakMB, memoryMB),
      latestMB: memoryMB,
      samples: currentMemory.samples + 1,
    });
  }
  if (!sample.idle?.isIdle && isBrowserApp(appName, executableOf(sample))) {
    const tabName = browserTabLabel(title);
    const tabs = analytics.browserTabs.get(appName) || new Map();
    tabs.set(tabName, (tabs.get(tabName) || 0) + delta);
    analytics.browserTabs.set(appName, tabs);
  }

  if (!analytics.current || analytics.current.key !== key) {
    if (analytics.current) {
      analytics.current.endedAt = ts;
      analytics.current.accumulatedDuration = Math.max(0, (analytics.current.accumulatedDuration || 0) + (ts - analytics.current.segmentStartedAt));
      analytics.current.duration = analytics.current.accumulatedDuration;
      analytics.current.lastSeenAt = ts;
      analytics.current.isActive = false;
      analytics.sessionMap.set(analytics.current.key, { ...analytics.current });
      analytics.sessions = [...analytics.sessionMap.values()].sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0)).slice(0, 8);
      analytics.switches += 1;
      analytics.appDurations.set(analytics.current.appName, (analytics.appDurations.get(analytics.current.appName) || 0) + analytics.current.duration);
    }

    const existing = analytics.sessionMap.get(key);
    analytics.current = existing
      ? { ...existing, appName, title, executable: executableOf(sample), category: classifyApp(appName, title), segmentStartedAt: ts, isActive: true }
      : { key, appName, title, executable: executableOf(sample), category: classifyApp(appName, title), startedAt: ts, segmentStartedAt: ts, accumulatedDuration: 0, duration: 0, lastSeenAt: ts, isActive: true };
    analytics.sessionMap.delete(key);
  } else {
    analytics.current.lastSeenAt = ts;
    analytics.current.duration = Math.max(0, (analytics.current.accumulatedDuration || 0) + (ts - analytics.current.segmentStartedAt));
  }

  if (ram >= 88 && (!previous || (Number(previous.ram?.usagePercent ?? previous.ramUsage) || 0) < 88)) analytics.memorySpikes += 1;
  pushLimited(analytics.samples, { timestamp: ts, cpu, ram, netTotal, sample }, 60);
  pushLimited(analytics.cpu, cpu); pushLimited(analytics.ram, ram); pushLimited(analytics.net, netTotal, 36);
  pushLimited(analytics.health, healthScore(cpu, ram, sample.idle));
}

function renderUsage() {
  const rows = [...analytics.appDurations.entries()];
  if (analytics.current) rows.push([analytics.current.appName, (rows.find(([n]) => n === analytics.current.appName)?.[1] || 0) + analytics.current.duration]);
  const merged = new Map(); rows.forEach(([n, v]) => merged.set(n, Math.max(merged.get(n) || 0, v)));
  const total = [...merged.values()].reduce((a,b)=>a+b,0) || 1;
  els.usageBreakdown.innerHTML = [...merged.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([name, sec]) => {
    const percent = Math.round(sec / total * 100);
    const tabs = analytics.browserTabs.get(name);
    const tabRows = tabs
      ? [...tabs.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([tab, tabSec]) => `<div class="tab-row"><span>${tab}</span><b>${duration(tabSec)}</b></div>`).join("")
      : "";
    return `<div class="usage-row browser-aware"><header><strong>${name}</strong><span>${percent}%</span></header><div class="usage-bar"><div style="width:${percent}%"></div></div>${tabRows ? `<div class="tab-breakdown">${tabRows}</div>` : ""}</div>`;
  }).join("") || `<div class="usage-row"><header><strong>Collecting activity</strong><span>0%</span></header><div class="usage-bar"><div></div></div></div>`;
}
function renderTimeline() {
  const list = [analytics.current, ...analytics.sessions].filter(Boolean).slice(0, 14);
  const totalDuration = list.reduce((sum, s) => sum + (s.duration || 1), 0) || 1;
  els.focusTimeline.innerHTML = list.map((s, i) => {
    const widthPct = Math.max(5, Math.round((s.duration || 1) / totalDuration * 100));
    return `<div class="timeline-segment" style="flex:${widthPct};opacity:${1 - i * .03}" title="${s.appName} — ${duration(s.duration)}"><span class="tl-label">${s.appName.split('.')[0]}</span></div>`;
  }).join("");
  els.sessionTable.innerHTML = [analytics.current, ...analytics.sessions].filter(Boolean).slice(0, 7).map((s, i) => `<div class="session-row"><div><strong>${s.appName}</strong><span>${s.title || s.category}</span></div><div><time>${i === 0 ? "Active" : time(s.startedAt)}</time><strong>${duration(i === 0 ? s.duration : s.duration)}</strong></div></div>`).join("") || `<div class="session-row"><div><strong>Waiting for session</strong><span>Focus telemetry will appear here.</span></div><strong>—</strong></div>`;
}
function renderTopRamApps(topProcesses) {
  if (!els.topRamApps) return;
  const list = Array.isArray(topProcesses) ? topProcesses : [];
  if (!list.length) {
    els.topRamApps.innerHTML = `<div class="empty-state compact"><strong>Collecting RAM data</strong><span>Waiting for first sample from system.</span></div>`;
    return;
  }
  const max = Math.max(...list.map((p) => p.memoryMB), 1);
  els.topRamApps.innerHTML = list.map((p, i) => {
    const width = Math.max(4, Math.round((p.memoryMB / max) * 100));
    const severity = p.memoryMB >= 800 ? "bad" : p.memoryMB >= 400 ? "warn" : "good";
    return `<div class="rank-row ${severity}"><div class="rank-head"><span>#${i + 1}</span><strong>${p.name}</strong><b>${p.memoryMB.toFixed(1)} MB</b></div><div class="rank-bar"><div style="width:${width}%"></div></div><small>PID ${p.pid} • CPU ${p.cpuPercent}%</small></div>`;
  }).join("");
}
function renderDashboard(sample) {
  const cpu = analytics.cpu.at(-1) || 0, ram = analytics.ram.at(-1) || 0, health = analytics.health.at(-1) || 100;
  const cpuAvg = avg(analytics.cpu), cpuPeak = Math.max(...analytics.cpu, 0), ramAvg = avg(analytics.ram);
  const netUp = Number(sample.network?.uploadKBps) || 0, netDown = Number(sample.network?.downloadKBps) || 0;
  const app = analytics.current || { appName: appNameOf(sample), title: titleOf(sample), executable: executableOf(sample), category: classifyApp(appNameOf(sample), titleOf(sample)), duration: 0 };

  setText(els.kpiCpu, pct(cpuAvg)); setText(els.kpiRam, pct(ram)); setText(els.kpiSessions, String(Math.max(1, analytics.sessions.length + (analytics.current ? 1 : 0)))); setText(els.kpiProcesses, sample.process?.pid ? "1+" : "—"); setText(els.kpiNetwork, kb(netUp + netDown)); setText(els.kpiHealth, `${health}`); setText(els.healthScore, `${health}`);
  setText(els.kpiCpuTrend, `Peak ${pct(cpuPeak)}`); setText(els.kpiRamTrend, `${ramAvg >= 85 ? "High pressure" : "Stable pressure"}`); setText(els.kpiSwitching, `${analytics.switches} switches`); setText(els.kpiNetworkQuality, netUp + netDown > 50 ? "Active link" : "Quiet link"); setText(els.kpiHealthTrend, health > 82 ? "Excellent" : health > 68 ? "Watch" : "Needs attention");
  setText(els.cpuNow, pct(cpu)); setText(els.cpuPeak, pct(cpuPeak)); setText(els.cpuAvg, pct(cpuAvg));
  setText(els.ramNow, pct(ram)); setText(els.ramDetail, `${gb(sample.ram?.usedGB)} used / ${gb(sample.ram?.freeGB)} free`); setText(els.memoryPressure, ram > 88 ? "High memory pressure detected" : ram > 75 ? "Moderate memory pressure" : "Memory pressure healthy");
  const storagePct = Number(sample.storage?.usagePercent) || 0; els.storageFill.style.width = `${clamp(storagePct,0,100)}%`; setText(els.storageUsed, gb(sample.storage?.usedGB)); setText(els.storageFree, gb(sample.storage?.freeGB)); setText(els.storageStatus, storagePct > 88 ? "Critical" : storagePct > 75 ? "Watch" : "Healthy");
  setText(els.netUp, kb(netUp)); setText(els.netDown, kb(netDown));
  setText(els.activeApp, app.appName); setText(els.activeTitle, app.title || "No active title captured"); setText(els.activeExecutable, app.executable || "Executable unavailable"); setText(els.activeDuration, duration(app.duration)); setText(els.appCategory, app.category); setText(els.appAvatar, (app.appName || "?").slice(0,1).toUpperCase());
  const activeRatio = analytics.activeSeconds + analytics.idleSeconds ? Math.round(analytics.activeSeconds / (analytics.activeSeconds + analytics.idleSeconds) * 100) : 0;
  setText(els.activeIdleRatio, `${activeRatio}% active`); setText(els.switchFrequency, `${analytics.switches} switches`); setText(els.memorySpikes, String(analytics.memorySpikes)); setText(els.anomalyState, cpu > 92 || ram > 92 ? "Anomaly detected" : "Stable");
  setText(els.lastSync, time(sample.timestamp));

  const gpu = Number(sample.gpu?.usagePercent ?? sample.gpuUsage) || 0;
  setText(els.gpuNow, pct(gpu));
  donut(els.donutGpu, gpu);
  setText(els.gpuStatus, gpu > 85 ? "Critical load" : gpu > 60 ? "Moderate load" : "GPU load healthy");

  svgLine(els.chartCpu, analytics.cpu, { width: 720, height: 220, max: 100 }); svgLine(els.chartNetwork, analytics.net, { width: 360, height: 170, max: Math.max(100, ...analytics.net) }); donut(els.donutRam, ram);
  spark("#spark-cpu", analytics.cpu); spark("#spark-ram", analytics.ram); spark("#spark-network", analytics.net.map(v => Math.min(100, v))); spark("#spark-health", analytics.health); spark("#spark-active-devices", [80,82,88,91,96,100]); spark("#spark-online-employees", [70,76,82,88,96,100]); spark("#spark-sessions", analytics.sessions.map((_,i)=>20+i*12).concat([80])); spark("#spark-processes", analytics.cpu.map(v=>Math.min(100, v+10)));
  renderUsage(); renderTimeline(); renderTopRamApps(sample.topProcesses);
}

async function afterLogin(session) {
  showDashboard(session); showLoginError("");
  const start = await api.invoke("monitor:start");
  if (!start.ok) showLoginError(start.error || "Gagal memulai monitor.");
  else if (start.deviceId) setText(els.deviceIdCompact, start.deviceId);
}

api.on("device:info", ({ deviceId, info, intervalMs }) => {
  setText(els.deviceIdCompact, deviceId || info?.hostname || "Registered device");
  setText(els.deviceCount, "1");
  if (info?.hostname) els.deviceIdCompact.title = `${info.hostname} • ${info.os || "OS"} • ${info.ram?.totalGB || "—"}GB RAM • ${Math.round((intervalMs || 5000)/1000)}s interval`;
  
  if (info) {
    setText(els.specCpu, info.cpu?.brand || info.cpuModel || "Unknown");
    setText(els.specRam, `${info.ram?.totalGB || info.totalRam || 0} GB ${info.ram?.type || ""}`.trim());
    setText(els.specGpu, info.gpu?.model || "Unknown");
    setText(els.specSsd, info.disk ? `${info.disk.name || "Unknown"} (${info.disk.sizeGB || 0} GB)` : "Unknown");
    setText(els.specIp, info.network?.localIp || "Unknown");
    setText(els.specMac, info.network?.macAddress || "Unknown");
  }
});

els.btnGoogleLogin.addEventListener("click", async () => { showLoginError(""); setLoginBusy(true); try { await api.invoke("auth:open-google"); } catch (err) { showLoginError(err?.message || "Terjadi kesalahan."); setLoginBusy(false); } });
document.getElementById("btn-apple-login")?.addEventListener("click", async () => { showLoginError(""); setLoginBusy(true); try { await api.invoke("auth:open-apple"); } catch (err) { showLoginError(err?.message || "Terjadi kesalahan."); setLoginBusy(false); } });
api.on("auth:login-success", async (session) => { setLoginBusy(false); try { await afterLogin(session); } catch (err) { showLoginError(err?.message || "Terjadi kesalahan."); } });
api.on("auth:login-error", ({ error }) => { setLoginBusy(false); showLoginError(error || "Login gagal."); });
els.btnLogout.addEventListener("click", async () => { await api.invoke("auth:logout"); setStatus(false); showLogin(); });
if (els.btnToggle) {
  els.btnToggle.addEventListener("click", async () => {
    els.btnToggle.disabled = true;
    try {
      const res = await api.invoke(running ? "monitor:stop" : "monitor:start");
      if (!res.ok && !running) setText(els.statusText, res.error || "Gagal memulai.");
    } finally {
      els.btnToggle.disabled = false;
    }
  });
}
api.on("monitor:sample", (sample) => {
  if (!sample) return;
  lastSample = sample;
  updateAnalytics(sample);
  renderDashboard(sample);
  if (currentRoute !== "dashboard") renderRoute(currentRoute);
});
api.on("monitor:status-changed", ({ running: r }) => setStatus(r));

// Handle update status broadcasts from main process
function updateStatusLabel(state) {
  const s = state || currentUpdateState;
  switch (s.status) {
    case "checking": return "Memeriksa pembaruan...";
    case "available": return s.version ? `v${s.version} tersedia` : "Pembaruan tersedia";
    case "downloading": return `Mengunduh ${s.progress || 0}%...`;
    case "ready": return `v${s.version} siap dipasang`;
    case "not-available": return "✓ Versi terbaru";
    case "error": return `Gagal memeriksa: ${s.error || "Unknown error"}`;
    default: return "Memeriksa pembaruan...";
  }
}
function updateVersionUI(data) {
  if (data.currentVersion) {
    currentVersion = data.currentVersion;
    setText(els.versionText, `v${currentVersion}`);
  }
  currentUpdateState = data;
  const versionInfoEl = els.versionInfo;
  if (versionInfoEl) {
    versionInfoEl.className = "version-info";
    switch (data.status) {
      case "not-available": versionInfoEl.classList.add("up-to-date"); break;
      case "checking": versionInfoEl.classList.add("checking"); break;
      case "available":
      case "downloading": versionInfoEl.classList.add("downloading"); break;
      case "ready": versionInfoEl.classList.add("ready"); break;
      case "error": versionInfoEl.classList.add("error"); break;
    }
  }
  const iconEl = versionInfoEl?.querySelector(".version-icon");
  if (iconEl) {
    switch (data.status) {
      case "not-available": iconEl.textContent = "✓"; break;
      case "checking": iconEl.textContent = "⟲"; break;
      case "downloading":
      case "available": iconEl.textContent = "⬇"; break;
      case "ready": iconEl.textContent = "⬆"; break;
      case "error": iconEl.textContent = "✕"; break;
      default: iconEl.textContent = "⟲";
    }
  }
  setText(els.updateStatusText, updateStatusLabel(data));
  // Also update settings page if visible
  const settingsVersion = $("#settings-current-version");
  const settingsStatus = $("#settings-update-status");
  if (settingsVersion) setText(settingsVersion, `v${currentVersion}`);
  if (settingsStatus) setText(settingsStatus, updateStatusLabel(data));

  // Handle the modal overlay
  handleUpdateModal(data);
}

function toggleModal(modalSelector, visible) {
  const modal = $(modalSelector);
  if (!modal) return;
  modal.hidden = !visible;

  setTimeout(() => {
    const activeOverlays = document.querySelectorAll(".modal-overlay:not([hidden])").length;
    api.invoke("titlebar:dim", activeOverlays > 0);
  }, 50);
}

function handleUpdateModal(data) {
  const modal = $("#update-modal");
  if (!modal) return;

  const titleText = $("#update-title-text");
  const subtitleText = $("#update-subtitle-text");
  const currVerEl = $("#update-curr-ver");
  const newVerEl = $("#update-new-ver");
  const detailsArea = $("#update-details");
  const progressContainer = $("#update-progress-container");
  const progressFill = $("#update-progress-fill");
  const progressStatus = $("#update-progress-status");
  const progressPct = $("#update-progress-pct");
  const btnLater = $("#btn-update-later");
  const btnNow = $("#btn-update-now");
  const btnRestart = $("#btn-update-restart");
  const btnRestartLater = $("#btn-update-restart-later");

  if (!modal.dataset.bound) {
    modal.dataset.bound = "true";
    btnLater.addEventListener("click", () => {
      updateDeferred = true;
      toggleModal("#update-modal", false);
    });
    btnRestartLater.addEventListener("click", () => {
      updateDeferred = true;
      toggleModal("#update-modal", false);
    });
    btnNow.addEventListener("click", async () => {
      btnNow.disabled = true;
      btnLater.hidden = true;
      progressContainer.hidden = false;
      setText(progressStatus, "Memulai unduhan...");
      const res = await api.invoke("app:download-update");
      if (!res.ok) {
        setText(progressStatus, `Gagal: ${res.error || "Unknown error"}`);
        btnNow.disabled = false;
        btnLater.hidden = false;
      }
    });
    btnRestart.addEventListener("click", () => {
      api.invoke("app:install-update");
    });
  }

  if (updateDeferred && data.status === "available") {
    toggleModal("#update-modal", false);
    return;
  }

  if (data.status === "available") {
    toggleModal("#update-modal", true);
    detailsArea.hidden = false;
    progressContainer.hidden = true;
    btnLater.hidden = false;
    btnNow.hidden = false;
    btnNow.disabled = false;
    btnNow.textContent = "Update Sekarang";
    btnRestart.hidden = true;
    if (btnRestartLater) btnRestartLater.hidden = true;

    setText(titleText, "Pembaruan Tersedia");
    setText(subtitleText, `Versi baru v${data.version} telah dirilis.`);
    setText(currVerEl, `v${currentVersion}`);
    setText(newVerEl, `v${data.version}`);
  } else if (data.status === "downloading") {
    toggleModal("#update-modal", true);
    detailsArea.hidden = false;
    progressContainer.hidden = false;
    btnLater.hidden = true;
    btnNow.hidden = true;
    btnRestart.hidden = true;
    if (btnRestartLater) btnRestartLater.hidden = true;

    const percent = data.progress || 0;
    if (progressFill) progressFill.style.width = `${percent}%`;
    setText(progressPct, `${percent}%`);
    setText(progressStatus, "Mengunduh file pembaruan...");
  } else if (data.status === "ready") {
    toggleModal("#update-modal", true);
    detailsArea.hidden = false;
    progressContainer.hidden = false;
    btnLater.hidden = true;
    btnNow.hidden = true;
    btnRestart.hidden = false;
    if (btnRestartLater) btnRestartLater.hidden = false;

    if (progressFill) progressFill.style.width = "100%";
    setText(progressPct, "100%");
    setText(progressStatus, "Unduhan selesai! Siap dipasang.");
  } else if (data.status === "error") {
    if (!modal.hidden) {
      progressContainer.hidden = false;
      setText(progressStatus, `Error: ${data.error || "Gagal mengunduh"}`);
      btnLater.hidden = false;
      btnNow.hidden = false;
      btnNow.disabled = false;
      btnNow.textContent = "Coba Lagi";
      btnRestart.hidden = true;
      if (btnRestartLater) btnRestartLater.hidden = true;
    }
  } else {
    if (data.status === "not-available" || data.status === "idle") {
      toggleModal("#update-modal", false);
    }
  }
}

// Login Page Tab Switching Handler
const tabDeskripsi = $("#tab-deskripsi");
const tabPenggunaan = $("#tab-penggunaan");
const paneDeskripsi = $("#pane-deskripsi");
const panePenggunaan = $("#pane-penggunaan");

if (tabDeskripsi && tabPenggunaan && paneDeskripsi && panePenggunaan) {
  tabDeskripsi.addEventListener("click", () => {
    tabDeskripsi.classList.add("active");
    tabPenggunaan.classList.remove("active");
    paneDeskripsi.style.display = "block";
    panePenggunaan.style.display = "none";
  });

  tabPenggunaan.addEventListener("click", () => {
    tabPenggunaan.classList.add("active");
    tabDeskripsi.classList.remove("active");
    panePenggunaan.style.display = "block";
    paneDeskripsi.style.display = "none";
  });
}

// Exit Confirmation Modal Handler
const exitModal = $("#exit-modal");
const btnExitCancel = $("#btn-exit-cancel");
const btnExitConfirm = $("#btn-exit-confirm");

if (exitModal && btnExitCancel && btnExitConfirm) {
  btnExitCancel.addEventListener("click", () => {
    toggleModal("#exit-modal", false);
  });
  btnExitConfirm.addEventListener("click", () => {
    btnExitConfirm.disabled = true;
    api.invoke("app:confirm-close");
  });
  api.on("app:request-close", () => {
    toggleModal("#exit-modal", true);
  });
}

api.on("update:status", (data) => {
  updateVersionUI(data);
});

els.navItems.forEach((item) => {
  item.addEventListener("click", () => switchRoute(item.dataset.route));
  item.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      switchRoute(item.dataset.route);
    }
  });
});

async function refreshSession() {
  const res = await api.invoke("auth:session");
  if (!res.ok || !res.data?.hasToken) { showLogin(); return; }
  showDashboard(res.data);
  
  // Start monitoring automatically on launch/login
  const start = await api.invoke("monitor:start");
  if (start.ok) {
    setStatus(true);
    if (start.deviceId) {
      setText(els.deviceIdCompact, start.deviceId);
    }
  } else {
    // If auto-start failed, fallback to check status
    const status = await api.invoke("monitor:status");
    if (status.ok) {
      setStatus(status.data.running);
      setText(els.deviceIdCompact, status.data.deviceId || "Device registered after start");
    }
  }
  // Fetch version info
  api.invoke("app:get-version").then(res => {
    if (res.ok && res.data) {
      updateVersionUI({
        ...res.data.updateState,
        currentVersion: res.data.currentVersion,
      });
    }
  }).catch(() => {});
}

// ==========================================================================
// Diagnostics Page Controllers
// ==========================================================================
let diagnosticsPollInterval = null;
let diagnosticsLogsInterval = null;
let logFilterLevel = "ALL";

async function getGeolocationStatus() {
  if (!navigator.permissions || !navigator.permissions.query) return false;
  try {
    const status = await navigator.permissions.query({ name: "geolocation" });
    return status.state === "granted";
  } catch (_) {
    return false;
  }
}

function startDiagnosticsPolling() {
  if (diagnosticsPollInterval) clearInterval(diagnosticsPollInterval);
  if (diagnosticsLogsInterval) clearInterval(diagnosticsLogsInterval);

  const poll = async () => {
    try {
      const geoGranted = await getGeolocationStatus();
      const report = await api.invoke("diagnostics:get-report", geoGranted);
      updateDiagnosticsUI(report);
    } catch (_) {}
  };
  
  poll();
  if (!isMac) {
    diagnosticsPollInterval = setInterval(poll, 2500);
  }

  refreshLogs();
  if (!isMac) {
    diagnosticsLogsInterval = setInterval(refreshLogs, 3000);
  }
}

function stopDiagnosticsPolling() {
  if (diagnosticsPollInterval) {
    clearInterval(diagnosticsPollInterval);
    diagnosticsPollInterval = null;
  }
  if (diagnosticsLogsInterval) {
    clearInterval(diagnosticsLogsInterval);
    diagnosticsLogsInterval = null;
  }
}

function bindDiagnosticsEvents() {
  const btnExport = $("#btn-export-diagnostics");
  if (btnExport) {
    // Prevent duplicate handlers
    const newBtn = btnExport.cloneNode(true);
    btnExport.parentNode.replaceChild(newBtn, btnExport);
    
    newBtn.addEventListener("click", async () => {
      newBtn.disabled = true;
      const text = newBtn.innerHTML;
      newBtn.innerHTML = `<span>⏳</span> Exporting...`;
      try {
        const geoGranted = await getGeolocationStatus();
        const res = await api.invoke("diagnostics:export-report", geoGranted);
        if (res.ok) {
          alert(`Report exported successfully to:\n${res.filePath}`);
        } else {
          alert(`Export failed: ${res.error || 'Unknown error'}`);
        }
      } catch (err) {
        alert(`Export failed: ${err.message}`);
      } finally {
        newBtn.disabled = false;
        newBtn.innerHTML = text;
      }
    });
  }

  const btnRefresh = $("#btn-refresh-diagnostics");
  if (btnRefresh) {
    // Prevent duplicate handlers
    const newBtn = btnRefresh.cloneNode(true);
    btnRefresh.parentNode.replaceChild(newBtn, btnRefresh);
    
    newBtn.addEventListener("click", async () => {
      newBtn.disabled = true;
      const originalHTML = newBtn.innerHTML;
      newBtn.innerHTML = `<span>⏳</span> Refreshing...`;
      try {
        const geoGranted = await getGeolocationStatus();
        const report = await api.invoke("diagnostics:get-report", geoGranted);
        updateDiagnosticsUI(report);
        await refreshLogs();
      } catch (err) {
        console.error("Failed to refresh diagnostics", err);
      } finally {
        newBtn.disabled = false;
        newBtn.innerHTML = originalHTML;
      }
    });
  }

  const searchInput = $("#log-search");
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      refreshLogs();
    });
  }

  const lvlBtns = document.querySelectorAll(".btn-log-lvl");
  lvlBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      lvlBtns.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      logFilterLevel = btn.dataset.level;
      refreshLogs();
    });
  });
}

function updateDiagnosticsUI(report) {
  if (currentRoute !== "agent-diagnostics") return;
  if (!report) return;

  // 1) Agent Status
  const statusEl = $("#fields-agent-status");
  if (statusEl && report.agentStatus) {
    const s = report.agentStatus;
    statusEl.innerHTML = `
      <div class="diag-field"><label>Version</label><span>${s.agentVersion}</span></div>
      <div class="diag-field"><label>Platform</label><span>${s.platform}</span></div>
      <div class="diag-field"><label>OS Version</label><span>${s.osVersion}</span></div>
      <div class="diag-field"><label>Device ID</label><span>${s.deviceId || '—'}</span></div>
      <div class="diag-field"><label>User ID</label><span>${s.userId || '—'}</span></div>
      <div class="diag-field"><label>Company ID</label><span>${s.companyId || '—'}</span></div>
      <div class="diag-field"><label>Agent Running</label><span style="color:${s.agentRunning ? 'var(--green)' : 'var(--red)'}">${s.agentRunning}</span></div>
      <div class="diag-field"><label>Monitor Running</label><span style="color:${s.monitorRunning ? 'var(--green)' : 'var(--red)'}">${s.monitorRunning}</span></div>
      <div class="diag-field"><label>Last Heartbeat</label><span>${s.lastHeartbeat ? time(new Date(s.lastHeartbeat).getTime()/1000) : '—'}</span></div>
      <div class="diag-field"><label>Last Presence Update</label><span>${s.lastPresenceUpdate ? time(new Date(s.lastPresenceUpdate).getTime()/1000) : '—'}</span></div>
      <div class="diag-field"><label>Last Stats Update</label><span>${s.lastStatsUpdate ? time(new Date(s.lastStatsUpdate).getTime()/1000) : '—'}</span></div>
      <div class="diag-field"><label>Last Snapshot</label><span>${s.lastSnapshot ? time(new Date(s.lastSnapshot).getTime()/1000) : '—'}</span></div>
    `;
    
    const indicator = $("#agent-status-indicator");
    if (indicator) {
      indicator.className = `status-indicator ${s.monitorRunning ? 'healthy' : 'error'}`;
      indicator.innerHTML = `<span class="status-dot-mini"></span>${s.monitorRunning ? 'ACTIVE' : 'STANDBY'}`;
    }
  }

  // 3) WiFi Diagnostics
  const wifiEl = $("#fields-wifi-diagnostics");
  if (wifiEl && report.wifi) {
    const w = report.wifi;
    wifiEl.innerHTML = `
      <div class="diag-field"><label>SSID</label><span>${w.ssid || '<redacted>'}</span></div>
      <div class="diag-field"><label>BSSID</label><span>${w.bssid || '—'}</span></div>
      <div class="diag-field"><label>Interface</label><span>${w.interface}</span></div>
      <div class="diag-field"><label>Permission Status</label><span style="color:${w.permissionStatus === 'granted' ? 'var(--green)' : 'var(--red)'}">${w.permissionStatus}</span></div>
      <div class="diag-field"><label>Redacted Status</label><span>${w.isRedacted}</span></div>
      <div class="diag-field"><label>Collector Status</label><span style="color:${w.wifiCollectorStatus === 'healthy' ? 'var(--green)' : 'var(--red)'}">${w.wifiCollectorStatus}</span></div>
    `;

    const indicator = $("#wifi-status-indicator");
    if (indicator) {
      const isOk = w.wifiCollectorStatus === 'healthy' && w.ssid && w.ssid !== '<redacted>';
      indicator.className = `status-indicator ${isOk ? 'healthy' : w.isRedacted ? 'warning' : 'error'}`;
      indicator.innerHTML = `<span class="status-dot-mini"></span>${isOk ? 'HEALTHY' : w.isRedacted ? 'REDACTED' : 'ERROR'}`;
    }

    // Wi-Fi Root Cause Box
    const rcBox = $("#wifi-rc-box");
    const rcList = $("#wifi-rc-list");
    if (rcBox && rcList) {
      if (!w.ssid || w.ssid === '<redacted>' || w.isRedacted) {
        rcBox.style.display = "block";
        rcList.innerHTML = `
          <li>Location Services disabled (WiFi SSID retrieval may fail)</li>
          <li>macOS Tahoe/Sonoma/Sequoia privacy restriction</li>
          <li>Airport command or networksetup unavailable</li>
          <li>Collector parsing failure or permission denied</li>
        `;
      } else {
        rcBox.style.display = "none";
      }
    }

    const rawOut = $("#wifi-raw-output");
    if (rawOut) {
      rawOut.textContent = w.rawCollectorOutput || "No output collected";
    }
  }

  // 4) Permission Diagnostics
  const permEl = $("#fields-permissions-diagnostics");
  if (permEl && report.permissions) {
    const p = report.permissions;
    let html = "";
    let allOk = true;
    for (const [k, v] of Object.entries(p)) {
      if (!v) allOk = false;
      const color = v ? 'var(--green)' : 'var(--red)';
      html += `<div class="diag-field"><label>${k}</label><span style="color:${color}">${v ? 'GRANTED' : 'DENIED'}</span></div>`;
    }
    permEl.innerHTML = html;

    const indicator = $("#permissions-status-indicator");
    if (indicator) {
      indicator.className = `status-indicator ${allOk ? 'healthy' : 'error'}`;
      indicator.innerHTML = `<span class="status-dot-mini"></span>${allOk ? 'ALL GRANTED' : 'MISSING PERMS'}`;
    }
  }

  // 5) Firebase Diagnostics
  const fbEl = $("#fields-firebase-diagnostics");
  if (fbEl && report.firebase) {
    const fb = report.firebase;
    fbEl.innerHTML = `
      <div class="diag-field"><label>Auth Signed In</label><span style="color:${fb.authentication.signedIn ? 'var(--green)' : 'var(--red)'}">${fb.authentication.signedIn}</span></div>
      <div class="diag-field"><label>Auth Email</label><span>${fb.authentication.email || '—'}</span></div>
      <div class="diag-field"><label>Firestore Connected</label><span style="color:${fb.firestore.connected ? 'var(--green)' : 'var(--red)'}">${fb.firestore.connected}</span></div>
      <div class="diag-field"><label>Firestore Last Write</label><span>${fb.firestore.lastWrite ? time(new Date(fb.firestore.lastWrite).getTime()/1000) : '—'}</span></div>
      <div class="diag-field"><label>RTDB Connected</label><span style="color:${fb.realtimeDatabase.connected ? 'var(--green)' : 'var(--red)'}">${fb.realtimeDatabase.connected}</span></div>
      <div class="diag-field"><label>RTDB Last Write</label><span>${fb.realtimeDatabase.lastWrite ? time(new Date(fb.realtimeDatabase.lastWrite).getTime()/1000) : '—'}</span></div>
    `;

    const indicator = $("#firebase-status-indicator");
    if (indicator) {
      const allConnected = fb.firestore.connected && fb.realtimeDatabase.connected && fb.authentication.signedIn;
      indicator.className = `status-indicator ${allConnected ? 'healthy' : 'error'}`;
      indicator.innerHTML = `<span class="status-dot-mini"></span>${allConnected ? 'CONNECTED' : 'DISCONNECTED'}`;
    }
  }

  // 6) Presence Diagnostics
  const presEl = $("#fields-presence-diagnostics");
  if (presEl && report.presence) {
    const pr = report.presence;
    presEl.innerHTML = `
      <div class="diag-field"><label>Presence State</label><span style="color:${pr.presenceState === 'online' ? 'var(--green)' : 'var(--red)'}">${pr.presenceState}</span></div>
      <div class="diag-field"><label>Session ID</label><span>${pr.sessionId ? pr.sessionId.slice(0, 12) + '...' : '—'}</span></div>
      <div class="diag-field"><label>Current App</label><span>${pr.currentApp || '—'}</span></div>
      <div class="diag-field"><label>Heartbeat Age</label><span>${pr.heartbeatAgeSeconds} seconds</span></div>
      <div class="diag-field"><label>Write Latency</label><span>${pr.writeLatencyMs} ms</span></div>
      <div class="diag-field"><label>Presence Writes</label><span>${pr.presenceWriteCount} (Fail: ${pr.presenceFailureCount})</span></div>
    `;

    const indicator = $("#presence-status-indicator");
    if (indicator) {
      const presenceOk = pr.presenceState === 'online' && pr.heartbeatAgeSeconds < 120 && pr.presenceFailureCount === 0;
      indicator.className = `status-indicator ${presenceOk ? 'healthy' : pr.heartbeatAgeSeconds >= 480 ? 'error' : 'warning'}`;
      indicator.innerHTML = `<span class="status-dot-mini"></span>${presenceOk ? 'ACTIVE' : 'LATENCY/STALE'}`;
    }

    const rcBox = $("#presence-rc-box");
    const rcList = $("#presence-rc-list");
    if (rcBox && rcList) {
      if (pr.heartbeatAgeSeconds >= 480) {
        rcBox.style.display = "block";
        rcList.innerHTML = `
          <li>Local API unavailable or timed out</li>
          <li>Firebase write failure (Authentication expired)</li>
          <li>Presence engine stopped or internet connection down</li>
        `;
      } else {
        rcBox.style.display = "none";
      }
    }
  }

  // 7) Intelligence Pipeline Diagnostics
  const pipeTable = $("#table-pipeline-diagnostics");
  if (pipeTable && report.pipeline) {
    pipeTable.innerHTML = report.pipeline.map(p => {
      const statusColor = p.status === 'healthy' ? 'var(--green)' : 'var(--red)';
      return `<tr>
        <td><strong>${p.stage}</strong></td>
        <td><span style="color:${statusColor};font-weight:700;">${p.status.toUpperCase()}</span></td>
        <td>${p.lastProcessed ? time(new Date(p.lastProcessed).getTime()/1000) : '—'}</td>
        <td style="color:var(--red); font-weight:500;">${p.lastError || ''}</td>
      </tr>`;
    }).join("");
  }

  // 2) Collector Diagnostics
  const collTable = $("#table-collectors-diagnostics");
  if (collTable && report.collectors) {
    collTable.innerHTML = report.collectors.map(c => {
      const statusColor = c.status === 'healthy' ? 'var(--green)' : c.status === 'warning' ? 'var(--amber)' : 'var(--red)';
      return `<tr>
        <td><strong>${c.collector}</strong></td>
        <td><span style="color:${statusColor};font-weight:700;">${c.status.toUpperCase()}</span></td>
        <td>${c.lastRun ? time(new Date(c.lastRun).getTime()/1000) : '—'}</td>
        <td>${c.durationMs} ms</td>
        <td>${c.averageDurationMs} ms</td>
        <td style="color:var(--red); font-weight:500;">${c.lastError || ''}</td>
      </tr>`;
    }).join("");
  }

  // 8) Firestore Write Audit
  const fsTable = $("#table-firestore-audit");
  if (fsTable && report.recentFirestoreWrites) {
    fsTable.innerHTML = report.recentFirestoreWrites.map(w => {
      return `<tr>
        <td><strong>${w.collection}</strong></td>
        <td>${time(new Date(w.timestamp).getTime()/1000)}</td>
        <td><span style="color:${w.success ? 'var(--green)' : 'var(--red)'};font-weight:700;">${w.success ? 'SUCCESS' : 'FAIL'}</span> ${w.error ? `<br><small style="color:var(--red);">${w.error}</small>` : ''}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="3" style="text-align:center;">No writes captured yet</td></tr>`;
  }

  // 9) RTDB Write Audit
  const rtdbTable = $("#table-rtdb-audit");
  if (rtdbTable && report.recentRtdbWrites) {
    rtdbTable.innerHTML = report.recentRtdbWrites.map(w => {
      return `<tr>
        <td><strong>${w.path}</strong></td>
        <td>${time(new Date(w.lastWrite).getTime()/1000)}</td>
        <td><span style="color:${w.success ? 'var(--green)' : 'var(--red)'};font-weight:700;">${w.success ? 'SUCCESS' : 'FAIL'}</span> ${w.error ? `<br><small style="color:var(--red);">${w.error}</small>` : ''}</td>
      </tr>`;
    }).join("") || `<tr><td colspan="3" style="text-align:center;">No writes captured yet</td></tr>`;
  }
}

async function refreshLogs() {
  if (currentRoute !== "agent-diagnostics") return;
  const searchInput = $("#log-search");
  const search = searchInput ? searchInput.value : "";
  const logEntries = await api.invoke("diagnostics:get-logs", { level: logFilterLevel, search });
  const container = $("#log-list-entries");
  if (container) {
    if (!logEntries || logEntries.length === 0) {
      container.innerHTML = `<div style="text-align:center;color:#4b5563;padding-top:20px;">No logs match filters</div>`;
      return;
    }
    container.innerHTML = logEntries.map(l => {
      const date = new Date(l.timestamp);
      const tsStr = date.toISOString().replace("T", " ").replace("Z", "").slice(0, 19);
      const lvlClass = `level-${l.level.toLowerCase()}`;
      return `<div class="log-entry-row ${lvlClass}">
        <span class="ts">[${tsStr}]</span>
        <span class="level">[${l.level}]</span>
        <span class="module">[${l.module}]</span>
        <span class="msg">${l.message}</span>
      </div>`;
    }).join("");
  }
}

refreshSession().catch(() => showLogin());
