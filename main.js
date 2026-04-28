"use strict";

/**
 * Electron entry point.
 *
 * Responsibilities:
 *   - Create the (secure) BrowserWindow.
 *   - Wire up IPC handlers that proxy renderer requests into the auth /
 *     device / metrics services.
 *   - Drive the monitor loop and forward samples to the renderer.
 *
 * The renderer never does network IO, never reads the filesystem, never
 * imports Node modules. Every privileged action lives here.
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
      // Renderer must NEVER reach the network or local files directly. All
      // such operations go through the IPC handlers below.
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

function setupIpc() {
  ipcMain.handle("auth:login", async (_e, payload) => {
    try {
      const session = await authService.login(payload || {});
      return { ok: true, data: session };
    } catch (err) {
      log.warn("login failed", { err: err.message });
      return { ok: false, error: err.message };
    }
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
      // Ensure the device is registered before we start pushing metrics.
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
