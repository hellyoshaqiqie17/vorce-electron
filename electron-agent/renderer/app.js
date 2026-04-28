"use strict";

/**
 * Renderer logic. Talks ONLY to window.vorceAgent (exposed by preload.js).
 *
 * No fetch(), no Node modules, no filesystem. The CSP in index.html also
 * forbids connect-src so a stray fetch would be blocked.
 */

const api = window.vorceAgent;

const $ = (sel) => document.querySelector(sel);

const els = {
  viewLogin: $("#view-login"),
  viewDashboard: $("#view-dashboard"),
  btnGoogleLogin: $("#btn-google-login"),
  loginError: $("#login-error"),
  sessionEmail: $("#session-email"),
  btnLogout: $("#btn-logout"),
  btnToggle: $("#btn-toggle"),
  statusDot: $("#status-dot"),
  statusText: $("#status-text"),
  kvDeviceId: $("#kv-device-id"),
  kvInterval: $("#kv-interval"),
  metricCpu: $("#metric-cpu"),
  barCpu: $("#bar-cpu"),
  metricRam: $("#metric-ram"),
  barRam: $("#bar-ram"),
  kvApp: $("#kv-app"),
  kvTitle: $("#kv-title"),
  kvIdle: $("#kv-idle"),
  kvUpdated: $("#kv-updated"),
};

let running = false;

/* ───────────── view state ───────────── */

function showLogin() {
  els.viewLogin.hidden = false;
  els.viewDashboard.hidden = true;
}

function showDashboard(session) {
  els.viewLogin.hidden = true;
  els.viewDashboard.hidden = false;
  els.sessionEmail.textContent = session.email
    ? `Masuk sebagai ${session.email}`
    : "";
}

function setStatus(isRunning) {
  running = Boolean(isRunning);
  els.statusDot.classList.toggle("active", running);
  els.statusText.textContent = running ? "Mengirim metrik" : "Berhenti";
  els.btnToggle.textContent = running ? "Berhenti" : "Mulai";
}

function showLoginError(message) {
  if (!message) {
    els.loginError.hidden = true;
    els.loginError.textContent = "";
    return;
  }
  els.loginError.hidden = false;
  els.loginError.textContent = message;
}

function setLoginBusy(busy) {
  els.btnGoogleLogin.disabled = busy;
  els.btnGoogleLogin.querySelector(".btn-label").textContent = busy
    ? "Memproses\u2026"
    : "Masuk dengan Google";
}

/* ───────────── formatting ───────────── */

function formatPct(v) {
  if (v == null) return "\u2014";
  return `${Math.round(v)}%`;
}

function formatIdle(idle) {
  if (!idle) return "\u2014";
  const s = Math.max(0, Math.round(Number(idle.seconds) || 0));
  const label = idle.isIdle ? "Idle" : "Aktif";
  if (s < 60) return `${label} \u00b7 ${s}s`;
  const m = Math.floor(s / 60);
  return `${label} \u00b7 ${m}m ${s % 60}s`;
}

function formatTime(ts) {
  const d = ts ? new Date(ts * 1000) : new Date();
  return d.toLocaleTimeString("id-ID", { hour12: false });
}

/* ───────────── post-login setup ───────────── */

async function afterLogin(session) {
  showDashboard(session);
  showLoginError("");

  const reg = await api.invoke("device:register");
  if (!reg.ok) {
    showLoginError(reg.error || "Pendaftaran perangkat gagal.");
    return;
  }
  els.kvDeviceId.textContent = reg.data.deviceId;

  const start = await api.invoke("monitor:start");
  if (!start.ok) {
    showLoginError(start.error || "Gagal memulai monitor.");
  }
}

/* ───────────── boot ───────────── */

async function refreshSession() {
  const res = await api.invoke("auth:session");
  if (!res.ok) {
    showLogin();
    return;
  }
  const session = res.data;
  if (!session.hasToken) {
    showLogin();
    return;
  }
  showDashboard(session);

  const status = await api.invoke("monitor:status");
  if (status.ok) {
    els.kvDeviceId.textContent = status.data.deviceId || "Belum terdaftar";
    els.kvInterval.textContent = `${Math.round(
      status.data.intervalMs / 1000
    )} detik`;
    setStatus(status.data.running);
  }
}

/* ───────────── handlers ───────────── */

els.btnGoogleLogin.addEventListener("click", async () => {
  showLoginError("");
  setLoginBusy(true);
  try {
    await api.invoke("auth:open-google");
  } catch (err) {
    showLoginError(err && err.message ? err.message : "Terjadi kesalahan.");
    setLoginBusy(false);
  }
});

api.on("auth:login-success", async (session) => {
  setLoginBusy(false);
  try {
    await afterLogin(session);
  } catch (err) {
    showLoginError(err && err.message ? err.message : "Terjadi kesalahan.");
  }
});

api.on("auth:login-error", ({ error }) => {
  setLoginBusy(false);
  showLoginError(error || "Login gagal.");
});

els.btnLogout.addEventListener("click", async () => {
  await api.invoke("auth:logout");
  setStatus(false);
  showLogin();
});

els.btnToggle.addEventListener("click", async () => {
  els.btnToggle.disabled = true;
  try {
    const channel = running ? "monitor:stop" : "monitor:start";
    const res = await api.invoke(channel);
    if (!res.ok && !running) {
      els.statusText.textContent = res.error || "Gagal memulai.";
    }
  } finally {
    els.btnToggle.disabled = false;
  }
});

api.on("monitor:sample", (sample) => {
  if (!sample) return;
  els.metricCpu.textContent = formatPct(sample.cpu);
  els.barCpu.style.width = `${Math.max(0, Math.min(100, sample.cpu || 0))}%`;
  els.metricRam.textContent = formatPct(sample.ram);
  els.barRam.style.width = `${Math.max(0, Math.min(100, sample.ram || 0))}%`;

  const app = sample.activeApp || {};
  els.kvApp.textContent = app.name || "\u2014";
  els.kvTitle.textContent = app.title || "\u2014";
  els.kvIdle.textContent = formatIdle(sample.idle);
  els.kvUpdated.textContent = formatTime(sample.timestamp);
});

api.on("monitor:status-changed", ({ running: r }) => setStatus(r));

refreshSession().catch(() => showLogin());
