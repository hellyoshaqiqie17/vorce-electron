"use strict";

/**
 * Electron entry point.
 *
 * - Creates the secure BrowserWindow.
 * - Opens a dedicated Google Sign-In window for authentication.
 * - Wires up IPC handlers that proxy renderer requests into auth /
 *   device / metrics services.
 * - Drives the monitor loop and forwards samples to the renderer.
 */

const path = require("path");
const { app, BrowserWindow, ipcMain } = require("electron");

const config = require("./core/config");
const monitor = require("./core/monitor");
const authService = require("./services/authService");
const deviceService = require("./services/deviceService");
const { make } = require("./utils/logger");

const log = make("main");

let mainWindow = null;
let authWindow = null;
let authResolved = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 460,
    height: 720,
    minWidth: 420,
    minHeight: 600,
    title: "VORCE Agent",
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#0f172a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function openGoogleAuthWindow() {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.focus();
    return;
  }

  authResolved = false;

  authWindow = new BrowserWindow({
    width: 480,
    height: 640,
    title: "VORCE - Masuk dengan Google",
    autoHideMenuBar: true,
    backgroundColor: "#0f172a",
    parent: mainWindow,
    modal: true,
    webPreferences: {
      preload: path.join(__dirname, "auth-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  authWindow.loadFile(
    path.join(__dirname, "renderer", "google-auth.html")
  );

  authWindow.on("closed", () => {
    authWindow = null;
    if (!authResolved) {
      broadcast("auth:login-error", { error: "Jendela login ditutup." });
    }
  });
}

function closeAuthWindow() {
  if (authWindow && !authWindow.isDestroyed()) {
    authWindow.close();
    authWindow = null;
  }
}

function setupIpc() {
  ipcMain.handle("google-auth:get-config", () => config.firebase);

  ipcMain.on("google-auth:token", async (_e, { idToken, email }) => {
    authResolved = true;
    try {
      const session = await authService.loginWithGoogle({ idToken, email });
      closeAuthWindow();
      broadcast("auth:login-success", session);
    } catch (err) {
      log.warn("google login backend failed", { err: err.message });
      closeAuthWindow();
      broadcast("auth:login-error", { error: err.message });
    }
  });

  ipcMain.on("google-auth:error", (_e, { error }) => {
    authResolved = true;
    log.warn("google auth error", { error });
    closeAuthWindow();
    broadcast("auth:login-error", { error });
  });

  ipcMain.handle("auth:open-google", async () => {
    openGoogleAuthWindow();
    return { ok: true };
  });

  ipcMain.handle("auth:logout", () => {
    monitor.stop();
    broadcast("monitor:status-changed", { running: false });
    authService.logout();
    return { ok: true };
  });

  ipcMain.handle("auth:session", () => ({
    ok: true,
    data: authService.currentSession(),
  }));

  ipcMain.handle("device:register", async () => {
    try {
      const out = await deviceService.ensureRegistered();
      return { ok: true, data: out };
    } catch (err) {
      log.warn("device register failed", { err: err.message });
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("monitor:start", async () => {
    try {
      if (!authService.isLoggedIn()) {
        return { ok: false, error: "Belum login." };
      }
      await deviceService.ensureRegistered();

      monitor.start({
        onSample: (sample) => broadcast("monitor:sample", sample),
      });
      broadcast("monitor:status-changed", { running: true });
      return { ok: true };
    } catch (err) {
      log.error("monitor start failed", { err: err.message });
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("monitor:stop", () => {
    monitor.stop();
    broadcast("monitor:status-changed", { running: false });
    return { ok: true };
  });

  ipcMain.handle("monitor:status", () => ({
    ok: true,
    data: {
      running: monitor.isRunning(),
      intervalMs: config.metricsIntervalMs,
      deviceId: deviceService.getDeviceId(),
    },
  }));
}

app.whenReady().then(() => {
  log.info("agent starting", {
    apiBaseUrl: config.apiBaseUrl,
    intervalMs: config.metricsIntervalMs,
  });

  setupIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  monitor.stop();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  monitor.stop();
});
