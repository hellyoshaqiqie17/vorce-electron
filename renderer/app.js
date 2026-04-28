"use strict";

/**
 * Renderer logic. Talks ONLY to window.vorceAgent (exposed by preload.js).
 *
 * No fetch(), no Node modules, no filesystem. The CSP in index.html also
 * forbids `connect-src` so a stray `fetch` would be blocked even if it were
 * accidentally added.
 */

const api = window.vorceAgent;

const $ = (sel) => document.querySelector(sel);

const els = {
  viewLogin: $("#view-login"),
  viewDashboard: $("#view-dashboard"),
  loginForm: $("#login-form"),
  loginEmail: $("#login-email"),
  loginPassword: $("#login-password"),
  loginSubmit: $("#login-submit"),
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
  els.loginPassword.value = "";
  els.loginEmail.focus();
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
  els.loginSubmit.disabled = busy;
  els.loginSubmit.querySelector(".btn-label").textContent = busy
    ? "Memproses…"
    : "Masuk";
}

/* ───────────── formatting ───────────── */

function formatPct(v) {
  if (v == null) return "—";
  return `${Math.round(v)}%`;
}

function formatIdle(idle) {
  if (!idle) return "—";
  const s = Math.max(0, Math.round(Number(idle.seconds) || 0));
  const label = idle.isIdle ? "Idle" : "Aktif";
  if (s < 60) return `${label} · ${s}s`;
  const m = Math.floor(s / 60);
  return `${label} · ${m}m ${s % 60}s`;
}

function formatTime(ts) {
  const d = ts ? new Date(ts * 1000) : new Date();
  return d.toLocaleTimeString("id-ID", { hour12: false });
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

els.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showLoginError("");
  setLoginBusy(true);

  const email = els.loginEmail.value.trim();
  const password = els.loginPassword.value;

  try {
    const res = await api.invoke("auth:login", { email, password });
    if (!res.ok) {
      showLoginError(res.error || "Login gagal.");
      return;
    }

    showDashboard(res.data);

    // Register the device immediately so the dashboard can show the deviceId
    // before the first tick fires.
    const reg = await api.invoke("device:register");
    if (!reg.ok) {
      showLoginError(reg.error || "Pendaftaran perangkat gagal.");
      return;
    }
    els.kvDeviceId.textContent = reg.data.deviceId;

    // Auto-start monitoring after a successful login + register.
    const start = await api.invoke("monitor:start");
    if (!start.ok) {
      showLoginError(start.error || "Gagal memulai monitor.");
    }
  } catch (err) {
    showLoginError(err && err.message ? err.message : "Terjadi kesalahan.");
  } finally {
    setLoginBusy(false);
  }
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
      // start failed — surface error in the dashboard area via title
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
  els.kvApp.textContent = app.name || "—";
  els.kvTitle.textContent = app.title || "—";
  els.kvIdle.textContent = formatIdle(sample.idle);
  els.kvUpdated.textContent = formatTime(sample.timestamp);
});

api.on("monitor:status-changed", ({ running: r }) => setStatus(r));

refreshSession().catch(() => showLogin());
