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
const http = require("http");
const { exec } = require("child_process");
const { shell, nativeImage } = require("electron");
const { app, BrowserWindow, ipcMain, dialog, systemPreferences, Notification } = require("electron");
const { autoUpdater } = require("electron-updater");

// Disable Edge/Chromium built-in sidebar before app is ready
app.commandLine.appendSwitch("disable-features", "msEdgeSidebarV2,msEdgeSidebar,EdgeSidebar");
app.commandLine.appendSwitch("disable-extensions");

// Register custom protocol for deep linking (vlinked://)
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("vlinked", process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient("vlinked");
}

// Handle vlinked:// protocol on macOS (must be registered early, before ready)
app.on("open-url", (event, url) => {
  event.preventDefault();
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// Handle protocol URL on Windows (single instance)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (event, commandLine) => {
    // Someone tried to open vlinked:// while app is running — focus the window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Kill any process using a specific port (Windows & macOS/Linux)
function killProcessOnPort(port) {
  return new Promise((resolve) => {
    if (process.platform === "win32") {
      exec(`for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port}') do taskkill /PID %a /F`, (err) => {
        if (err) {
          log.info(`no process found using port ${port} or could not kill`);
        } else {
          log.info(`killed process using port ${port}`);
        }
        resolve();
      });
    } else {
      exec(`lsof -t -i:${port} | xargs kill -9`, (err) => {
        if (err) {
          log.info(`no process found using port ${port} or could not kill`);
        } else {
          log.info(`killed process using port ${port} (unix)`);
        }
        resolve();
      });
    }
  });
}

const config = require("./core/config");
const monitor = require("./core/monitor");
const authService = require("./services/authService");
const deviceService = require("./services/deviceService");
const localApiServer = require("./services/localApiServer");
const { make } = require("./utils/logger");

const log = make("main");

let mainWindow = null;
let currentTheme = "login";
let isAppQuitting = false;
let isQuitting = false;
let authResolved = false;
let authServer = null;
let authServerPort = 0;

function startAuthServer(preferredPort = 0) {
  return new Promise(async (resolve, reject) => {
    if (authServer) { resolve(authServerPort); return; }

    const tryListen = (port, retries = 3) => {
      return new Promise((res, rej) => {
        const server = http.createServer((req, res) => {
          const url = `http://localhost:${port}${req.url}`;

          // Check if this is the OAuth callback from Google/Firebase
          if (req.url.startsWith("/__/auth/handler")) {
            // Handle the callback
            handleOAuthCallback(url);

            // Respond to browser with success page
            res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
            res.end(`<!DOCTYPE html>
<html>
<head>
  <title>Vlinked - Login Berhasil</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #ffffff; display: flex; align-items: center; justify-content: center; height: 100vh; }
    .container { text-align: center; padding: 3rem; }
    .check { width: 64px; height: 64px; border-radius: 50%; background: #f0fdf4; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 1.5rem; }
    .check svg { width: 32px; height: 32px; }
    h1 { color: #1a1a1a; font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }
    p { color: #6b7280; font-size: 0.9rem; margin-bottom: 2rem; }
    .btn-open { display: inline-flex; align-items: center; gap: 8px; padding: 12px 28px; background: #5A30FF; color: #ffffff; border: none; border-radius: 8px; font-size: 0.9rem; font-weight: 600; cursor: pointer; text-decoration: none; transition: opacity .15s; }
    .btn-open:hover { opacity: .85; }
    .hint { color: #9ca3af; font-size: 0.75rem; margin-top: 1rem; }
    .brand { display: inline-flex; align-items: center; gap: 8px; color: #9ca3af; font-size: 0.8rem; margin-top: 2rem; }
    .brand-dot { width: 20px; height: 20px; border-radius: 6px; background: #5A30FF; display: inline-flex; align-items: center; justify-content: center; color: white; font-size: 10px; font-weight: 800; }
  </style>
</head>
<body>
  <div class="container">
    <div class="check"><svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>
    <h1>Login Berhasil</h1>
    <p>Akun Anda telah terverifikasi.</p>
    <a href="vlinked://auth-success" class="btn-open" id="btn-open">Buka Vlinked</a>
    <p class="hint">Atau tab ini akan tertutup otomatis dalam 5 detik</p>
    <div class="brand"><svg width="20" height="20" viewBox="0 0 2617 2617" style="border-radius:4px"><rect width="2617" height="2617" fill="#5A30FF" rx="400"/><path d="M743 517c200-50 400 50 500 200s150 350 100 550-200 350-400 400-400-50-500-200-150-350-100-550 200-350 400-400z" fill="#fff"/><path d="M1310 517c200-50 400 50 500 200s150 350 100 550-200 350-400 400-400-50-500-200-150-350-100-550 200-350 400-400z" fill="#fff"/><circle cx="1965" cy="960" r="450" fill="#F79A28"/></svg> Vlinked</div>
  </div>
  <script>
    document.getElementById('btn-open').addEventListener('click', function(e) {
      // Try protocol link
      window.location.href = 'vlinked://auth-success';
      // Close tab after short delay
      setTimeout(() => window.close(), 500);
    });
    // Auto close after 5s
    setTimeout(() => window.close(), 5000);
  </script>
</body>
</html>`);
            return;
          }

          // Default response
          res.writeHead(200, { "Content-Type": "text/plain" });
          res.end("ok");
        });

        server.on("error", async (err) => {
          if (err.code === "EADDRINUSE" && retries > 0) {
            log.warn(`Port ${port} in use, retrying in 500ms... (${retries} retries left)`);
            await new Promise(r => setTimeout(r, 500));
            tryListen(port, retries - 1).then(res).catch(rej);
          } else {
            rej(err);
          }
        });

        server.listen(port, "127.0.0.1", () => {
          authServer = server;
          authServerPort = port;
          log.info("auth callback server listening", { port });
          res(port);
        });
      });
    };

    // Try preferred port first with retries
    if (preferredPort !== 0) {
      try {
        const port = await tryListen(preferredPort, 5);
        return resolve(port);
      } catch (err) {
        log.warn(`Could not bind to preferred port ${preferredPort}, trying fallback`);
      }
    }

    // Fallback to unique high port
    const fallbackPort = 28765;
    try {
      const port = await tryListen(fallbackPort, 3);
      resolve(port);
    } catch (err) {
      // Last resort: random port
      tryListen(0).then(resolve).catch(reject);
    }
  });
}

// Store session ID for OAuth flow
let currentAuthSessionId = null;

async function fetchGoogleAuthUrl(continueUri) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${config.firebase.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        continueUri,
        providerId: "google.com",
        oauthScope: "email profile openid",
        customParameter: { prompt: "select_account" },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || JSON.stringify(data);
    log.error("createAuthUri failed", { status: res.status, msg });
    throw new Error(msg);
  }
  if (!data.authUri) throw new Error("Firebase tidak mengembalikan URL autentikasi.");

  // Store session ID for later use in signInWithIdp
  currentAuthSessionId = data.sessionId;
  log.info("createAuthUri ok", { sessionId: currentAuthSessionId?.slice(0, 10) + "..." });

  return data.authUri;
}

async function fetchAppleAuthUrl(continueUri) {
  // Apple doesn't support localhost redirect - use Firebase auth handler
  const firebaseRedirect = "https://hora-7394b.firebaseapp.com/__/auth/handler";
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${config.firebase.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        continueUri: firebaseRedirect,
        providerId: "apple.com",
        oauthScope: "email name",
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    const msg = data.error?.message || JSON.stringify(data);
    log.error("createAuthUri (apple) failed", { status: res.status, msg });
    throw new Error(msg);
  }
  if (!data.authUri) throw new Error("Firebase tidak mengembalikan URL autentikasi Apple.");

  currentAuthSessionId = data.sessionId;
  log.info("createAuthUri (apple) ok", { sessionId: currentAuthSessionId?.slice(0, 10) + "..." });

  return data.authUri;
}

// App icon will use the SVG file - on Windows it falls back to default if not .ico
// For proper Windows icon, convert vorce-logo.svg to .ico externally

function checkAccessibility() {
  if (process.platform !== "darwin") return true;
  return systemPreferences.isTrustedAccessibilityClient(false);
}

function checkAutomation() {
  return new Promise((resolve) => {
    if (process.platform !== "darwin") {
      resolve(true);
      return;
    }
    // Check if we can control System Events via AppleScript without blocking
    exec("osascript -e 'tell application \"System Events\" to get name'", { timeout: 2000 }, (err) => {
      if (err) {
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

function checkScreenRecording() {
  if (process.platform !== "darwin") return true;
  try {
    return systemPreferences.getMediaAccessStatus("screen") === "granted";
  } catch (err) {
    return true;
  }
}

function installUpdate() {
  Promise.all([
    monitor.stop(),
    deviceService.markOffline(),
    localApiServer.stop()
  ]).finally(() => {
    autoUpdater.quitAndInstall();
  });
}

function showInstallDialog(info) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Pembaruan Tersedia",
      message: `Versi baru (${info.version}) telah diunduh. Hubungkan ulang aplikasi untuk memasang pembaruan sekarang?`,
      buttons: ["Restart Sekarang", "Nanti"],
      defaultId: 0,
      cancelId: 1
    }).then((result) => {
      if (result.response === 0) {
        installUpdate();
      }
    });
  }
}

// Track update state so the renderer can query it
let updateState = {
  status: "idle", // idle | checking | available | not-available | downloading | ready | error
  version: null,
  progress: null,
  error: null,
};

let downloadNotification = null;
let lastNotificationProgress = -1;

function broadcastUpdateStatus() {
  broadcast("update:status", { ...updateState, currentVersion: app.getVersion() });
}

function setupAutoUpdater() {
  // Log update progress using the custom logger
  autoUpdater.logger = log;

  // Disable automatic downloading of updates to prompt the user first
  autoUpdater.autoDownload = false;

  // Set the update feed URL programmatically because building with '--publish never'
  // prevents electron-builder from generating and packaging app-update.yml.
  try {
    autoUpdater.setFeedURL({
      provider: "github",
      owner: "hellyoshaqiqie17",
      repo: "vorce-electron",
      vPrefixedTagName: true,
      tagNamePrefix: "v"
    });
  } catch (err) {
    log.error("Failed to set feed URL programmatically:", err.message);
  }

  // Listen to update events
  autoUpdater.on("checking-for-update", () => {
    log.info("Checking for update...");
    updateState = { status: "checking", version: null, progress: null, error: null };
    broadcastUpdateStatus();
  });

  autoUpdater.on("update-available", (info) => {
    log.info("Update available:", info);
    updateState = { status: "available", version: info.version, progress: null, error: null };
    broadcastUpdateStatus();
    if (Notification.isSupported()) {
      new Notification({
        title: "Vlinked — Pembaruan Tersedia",
        body: `Mengunduh versi baru (${info.version}) di latar belakang...`,
        silent: true
      }).show();
    }
  });

  autoUpdater.on("update-not-available", (info) => {
    log.info("Update not available.");
    updateState = { status: "not-available", version: info.version, progress: null, error: null };
    broadcastUpdateStatus();
    if (downloadNotification) {
      downloadNotification.close();
      downloadNotification = null;
    }
    lastNotificationProgress = -1;
  });

  autoUpdater.on("error", (err) => {
    log.error("Error in auto-updater:", err ? err.message : err);
    updateState = { ...updateState, status: "error", error: err ? err.message : "Unknown error" };
    broadcastUpdateStatus();
    if (downloadNotification) {
      downloadNotification.close();
      downloadNotification = null;
    }
    lastNotificationProgress = -1;
  });

  autoUpdater.on("download-progress", (progressObj) => {
    const percent = Math.round(progressObj.percent);
    log.info(`Download speed: ${progressObj.bytesPerSecond} - Downloaded ${percent}%`);
    updateState = { ...updateState, status: "downloading", progress: percent };
    broadcastUpdateStatus();

    // Throttled notification update to avoid notification spam
    if (percent - lastNotificationProgress >= 10 || percent === 100) {
      lastNotificationProgress = percent;
      if (Notification.isSupported()) {
        if (downloadNotification) {
          downloadNotification.close();
        }
        downloadNotification = new Notification({
          title: "Vlinked — Sedang Mengunduh",
          body: `Sedang mengunduh pembaruan: ${percent}% selesai.`,
          silent: true
        });
        downloadNotification.show();
      }
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    log.info("Update downloaded:", info);
    updateState = { status: "ready", version: info.version, progress: 100, error: null };
    broadcastUpdateStatus();
    
    if (downloadNotification) {
      downloadNotification.close();
      downloadNotification = null;
    }
    lastNotificationProgress = -1;

    if (Notification.isSupported()) {
      const notif = new Notification({
        title: "Vlinked — Pembaruan Siap Dipasang",
        body: `Versi baru (${info.version}) telah selesai diunduh. Klik untuk memasang sekarang.`
      });
      notif.show();
      notif.on("click", () => {
        installUpdate();
      });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    title: "Vlinked",
    icon: path.join(__dirname, "vorcelogo", "Vlinked.png"),
    show: false,
    frame: false,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "rgba(0, 0, 0, 0)",
      symbolColor: "#ffffff",
      height: 36,
    },
    autoHideMenuBar: true,
    backgroundColor: "#f8f9fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.maximize();
    mainWindow.webContents.setZoomFactor(0.85);
    mainWindow.show();

    // Setup auto updater and check for updates
    setupAutoUpdater();
    if (app.isPackaged) {
      autoUpdater.checkForUpdatesAndNotify();
    } else {
      log.info("App is in development mode - skipping auto-update check (simulating up-to-date state in UI)");
      setTimeout(() => {
        updateState = { status: "not-available", version: app.getVersion(), progress: null, error: null };
        broadcastUpdateStatus();
      }, 2000);
    }
  });

  mainWindow.on("close", async (e) => {
    if (isQuitting || isAppQuitting) return;

    e.preventDefault();
    broadcast("app:request-close");
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (process.platform === "darwin") {
    const hasAccessibility = checkAccessibility();
    const hasScreenRecording = checkScreenRecording();
    checkAutomation().then((hasAutomation) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (hasAccessibility && hasAutomation && hasScreenRecording) {
        mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
      } else {
        mainWindow.loadFile(path.join(__dirname, "renderer", "permissions.html"));
      }
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
  }

  // Hide any Edge/Chromium sidebar overlay after page loads
  mainWindow.webContents.on("dom-ready", () => {
    mainWindow.webContents.insertCSS(
      ".__ms-edge-sidebar, .edge-sidebar, [data-testid='sidebar'], #sidebar-container, .sidebar-container, #edge-sidebar { display: none !important; width: 0 !important; visibility: hidden !important; }"
    );
  });

  // Enable zoom shortcuts (Ctrl+Plus/Minus/0)
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.control && input.type === "keyDown") {
      if (input.key === "=" || input.key === "+") {
        event.preventDefault();
        const currentZoom = mainWindow.webContents.getZoomLevel();
        mainWindow.webContents.setZoomLevel(Math.min(currentZoom + 1, 5)); // Max zoom ~300%
      } else if (input.key === "-") {
        event.preventDefault();
        const currentZoom = mainWindow.webContents.getZoomLevel();
        mainWindow.webContents.setZoomLevel(Math.max(currentZoom - 1, -5)); // Min zoom ~33%
      } else if (input.key === "0") {
        event.preventDefault();
        mainWindow.webContents.setZoomLevel(0); // Reset to 100%
      }
    }
  });
}

function broadcast(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

/**
 * IMPORTANT: Firebase/Google Cloud Console Setup Required
 *
 * 1. Go to https://console.cloud.google.com/apis/credentials
 * 2. Find the OAuth 2.0 Client ID for your Firebase project (hora-7394b)
 * 3. Add to "Authorized redirect URIs": http://localhost:8765/__/auth/handler
 * 4. Save and wait 5 minutes for propagation
 *
 * Without this, you'll get "redirect_uri_mismatch" error.
 */
const AUTH_CALLBACK_PORT = 8765;

function openGoogleAuthInBrowser() {
  if (authResolved) return;
  authResolved = false;

  startExternalBrowserOAuth().catch((err) => {
    log.error("external oauth flow failed", { err: err.message });
    const isRedirectMismatch = err.message?.toLowerCase().includes("redirect_uri") ||
                               err.message?.toLowerCase().includes("mismatch");
    if (isRedirectMismatch) {
      // Get actual port used (may differ from preferred if port was in use)
      const actualPort = authServerPort || AUTH_CALLBACK_PORT;
      dialog.showErrorBox(
        "Vlinked Auth Setup Required",
        "Error: redirect_uri_mismatch\n\n" +
        "Anda perlu menambahkan localhost ke Authorized Redirect URIs:\n\n" +
        "1. Buka https://console.cloud.google.com/apis/credentials\n" +
        "2. Cari OAuth 2.0 Client ID untuk project hora-7394b\n" +
        "3. Tambahkan ke 'Authorized Redirect URIs':\n" +
        `   http://localhost:${actualPort}/__/auth/handler\n\n` +
        "4. Save dan tunggu 5 menit, lalu coba lagi."
      );
    } else {
      dialog.showErrorBox("Vlinked Auth Error", err.message || "Unknown error");
    }
    if (!authResolved) {
      broadcast("auth:login-error", { error: err.message });
    }
  });
}

async function startExternalBrowserOAuth() {
  // Reset auth server to get fresh port binding
  if (authServer) {
    authServer.close();
    authServer = null;
    authServerPort = 0;
  }

  // Force kill any process using the preferred port
  await killProcessOnPort(AUTH_CALLBACK_PORT);
  await new Promise(r => setTimeout(r, 200));

  const port = await startAuthServer(AUTH_CALLBACK_PORT);
  const continueUri = `http://localhost:${port}/__/auth/handler`;

  const authUri = await fetchGoogleAuthUrl(continueUri);
  log.info("opening external browser for oauth", { uri: authUri.slice(0, 80) + "..." });

  // Open user's default browser (Chrome, Edge, Firefox, etc.)
  await shell.openExternal(authUri);
}

async function startExternalBrowserAppleOAuth() {
  // Apple doesn't support localhost redirect, so we use an internal BrowserWindow
  // that loads the Apple auth URL with Firebase redirect, then intercept the callback
  const firebaseRedirect = "https://hora-7394b.firebaseapp.com/__/auth/handler";
  
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${config.firebase.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        continueUri: firebaseRedirect,
        providerId: "apple.com",
        oauthScope: "email name",
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Failed to get Apple auth URL");
  if (!data.authUri) throw new Error("Firebase tidak mengembalikan URL autentikasi Apple.");
  
  currentAuthSessionId = data.sessionId;
  log.info("apple auth uri ready", { sessionId: currentAuthSessionId?.slice(0, 10) + "..." });

  // Open in a new BrowserWindow to intercept the callback
  const authWindow = new BrowserWindow({
    width: 600,
    height: 700,
    title: "Sign in with Apple",
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });

  authWindow.loadURL(data.authUri);

  // Intercept navigation to Firebase callback URL
  authWindow.webContents.on("will-redirect", async (event, url) => {
    if (url.includes("/__/auth/handler") || url.includes("/__/auth/action")) {
      // Firebase auth handler will have the code in the URL
      try {
        const urlObj = new URL(url);
        const code = urlObj.searchParams.get("code");
        if (code) {
          event.preventDefault();
          authWindow.close();
          const authPayload = await exchangeCodeForToken(code, firebaseRedirect);
          const session = await authService.loginWithGoogle(authPayload);
          authResolved = true;
          broadcast("auth:login-success", session);
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          }
        }
      } catch (err) {
        log.error("apple auth callback failed", { err: err.message });
        authResolved = true;
        broadcast("auth:login-error", { error: err.message });
        authWindow.close();
      }
    }
  });

  // Also check page title/URL changes for the callback
  authWindow.webContents.on("did-navigate", async (event, url) => {
    if (url.includes("/__/auth/handler")) {
      try {
        const urlObj = new URL(url);
        const code = urlObj.searchParams.get("code");
        if (code) {
          authWindow.close();
          const authPayload = await exchangeCodeForToken(code, firebaseRedirect);
          const session = await authService.loginWithGoogle(authPayload);
          authResolved = true;
          broadcast("auth:login-success", session);
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
          }
        }
      } catch (err) {
        log.error("apple auth navigate failed", { err: err.message });
        authResolved = true;
        broadcast("auth:login-error", { error: err.message });
        authWindow.close();
      }
    }
  });

  authWindow.on("closed", () => {
    if (!authResolved) {
      broadcast("auth:login-error", { error: "Login dibatalkan." });
    }
  });
}

function openAppleAuthInBrowser() {
  if (authResolved) return;
  authResolved = false;

  startExternalBrowserAppleOAuth().catch((err) => {
    log.error("apple oauth flow failed", { err: err.message });
    dialog.showErrorBox("Vlinked Auth Error", err.message || "Apple login gagal");
    if (!authResolved) {
      broadcast("auth:login-error", { error: err.message });
    }
  });
}

async function exchangeCodeForToken(code, redirectUri) {
  if (!currentAuthSessionId) {
    throw new Error("Session ID tidak tersedia. Silakan coba login lagi.");
  }

  // Exchange OAuth authorization code for Firebase ID token using sessionId
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${config.firebase.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestUri: redirectUri,
        sessionId: currentAuthSessionId,
        code,
        returnSecureToken: true,
        returnIdpCredential: true,
      }),
    }
  );
  const data = await res.json();
  if (!res.ok || data.error) {
    const msg = data.error?.message || JSON.stringify(data);
    log.error("signInWithIdp failed", { msg });
    throw new Error(msg || "Gagal menukar code dengan token");
  }

  // Clear session ID after use
  currentAuthSessionId = null;

  if (!data.idToken) {
    throw new Error("Server tidak mengembalikan ID token");
  }

  return {
    idToken: data.idToken,
    refreshToken: data.refreshToken || "",
    localId: data.localId || "",
    email: data.email || "",
    displayName: data.displayName || "",
    oauthIdToken: data.oauthIdToken || "",
    oauthAccessToken: data.oauthAccessToken || "",
  };
}

async function handleOAuthCallback(url) {
  log.info("oauth callback received", { url });

  try {
    // Parse URL to find authorization code
    const urlObj = new URL(url);
    const params = new URLSearchParams(urlObj.search);

    // Log all params for debugging
    const allParams = Object.fromEntries(params.entries());
    log.info("callback params", allParams);

    // Check for authorization code (OAuth 2.0 flow)
    const code = params.get("code");

    if (!code) {
      log.error("no auth code found in callback", { url });
      throw new Error("Kode autentikasi tidak ditemukan. Parameter: " + JSON.stringify(allParams).slice(0, 200));
    }

    log.info("auth code received, exchanging for token");

    // Exchange code for Firebase ID token
    const authPayload = await exchangeCodeForToken(code, url);
    log.info("token received", { idToken: authPayload.idToken.slice(0, 20) + "..." });

    const session = await authService.loginWithGoogle(authPayload);
    authResolved = true;
    broadcast("auth:login-success", session);

    // Bring app to foreground immediately after successful login
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      mainWindow.flashFrame(false);
    }
  } catch (err) {
    log.warn("oauth callback failed", { err: err.message });
    authResolved = true;
    broadcast("auth:login-error", { error: err.message });
  }
}

function openMacPreferences(url) {
  if (process.platform !== "darwin") return;
  log.info("Opening macOS system preferences via exec open", { url });
  exec(`open "${url}"`, (err) => {
    if (err) {
      log.error("Failed to open macOS preferences via exec open", { err: err.message });
      shell.openExternal(url).catch((ex) => {
        log.error("Failed to open macOS preferences via shell.openExternal fallback", { err: ex.message });
      });
    }
  });
}

function setupIpc() {
  ipcMain.handle("auth:open-google", async () => {
    openGoogleAuthInBrowser();
    return { ok: true };
  });

  ipcMain.handle("auth:open-apple", async () => {
    openAppleAuthInBrowser();
    return { ok: true };
  });

  ipcMain.handle("auth:logout", async () => {
    await monitor.stop();
    broadcast("monitor:status-changed", { running: false });
    await authService.logout();
    authResolved = false;
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
      const { deviceId, info, error } = await deviceService.ensureRegistered();

      // Broadcast device info to renderer for display
      if (info) {
        broadcast("device:info", { deviceId, info, error, intervalMs: config.metricsIntervalMs });
      }

      monitor.start({
        onSample: (sample) => broadcast("monitor:sample", sample),
      });
      broadcast("monitor:status-changed", { running: true });
      return { ok: true, deviceId, error, intervalMs: config.metricsIntervalMs };
    } catch (err) {
      log.error("monitor start failed", { err: err.message });
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("monitor:stop", async () => {
    await monitor.stop();
    await deviceService.markOffline();
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

  ipcMain.handle("device:get-history", async () => {
    try {
      const state = deviceService.getRegistrationState();
      if (!state?.deviceId || !state?.binding?.companyId) {
        return { ok: false, error: "Device belum teregistrasi." };
      }
      const { getDoc } = require("firebase/firestore");
      const monitoringStore = require("./services/firestoreMonitoringStore");
      const docRef = monitoringStore.getDeviceRef(state.binding.companyId, state.deviceId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        return {
          ok: true,
          data: {
            cpuHistory: data.cpuHistory || [],
            ramHistory: data.ramHistory || [],
            gpuHistory: data.gpuHistory || [],
            ssdHistory: data.ssdHistory || [],
          }
        };
      }
      return { ok: true, data: { cpuHistory: [], ramHistory: [], gpuHistory: [], ssdHistory: [] } };
    } catch (err) {
      log.error("Failed to get device history", { err: err.message });
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle("permissions:check", async () => {
    const accessibility = checkAccessibility();
    const automation = await checkAutomation();
    const screenRecording = checkScreenRecording();
    const ok = accessibility && automation && screenRecording;
    
    if (ok && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
    }
    
    return { ok, accessibility, automation, screenRecording };
  });

  ipcMain.handle("permissions:bypass", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));
    }
    return { ok: true };
  });

  ipcMain.handle("permissions:request-accessibility", () => {
    openMacPreferences("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
    return { ok: true };
  });

  ipcMain.handle("permissions:request-automation", () => {
    openMacPreferences("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation");
    return { ok: true };
  });

  ipcMain.handle("permissions:request-screen-recording", async () => {
    if (process.platform === "darwin") {
      const { desktopCapturer } = require("electron");
      try {
        await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } });
      } catch (err) {
        log.error("Failed to trigger screen recording prompt", { err: err.message });
      }
      openMacPreferences("x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
    }
    return { ok: true };
  });

  ipcMain.handle("app:get-version", () => {
    return {
      ok: true,
      data: {
        currentVersion: app.getVersion(),
        updateState: { ...updateState },
      },
    };
  });

  ipcMain.handle("app:check-update", async () => {
    if (app.isPackaged) {
      try {
        await autoUpdater.checkForUpdatesAndNotify();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    } else {
      // In development mode, simulate checking for 1.5 seconds, then state becomes "available" (latest version)
      updateState = { status: "checking", version: null, progress: null, error: null };
      broadcastUpdateStatus();
      setTimeout(() => {
        updateState = { status: "available", version: "1.0.9", progress: null, error: null };
        broadcastUpdateStatus();
      }, 1500);
      return { ok: true };
    }
  });

  ipcMain.handle("app:download-update", async () => {
    if (app.isPackaged) {
      try {
        await autoUpdater.downloadUpdate();
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    } else {
      // In development mode, simulate downloading progress
      let pct = 0;
      updateState = { status: "downloading", version: "1.0.9", progress: pct, error: null };
      broadcastUpdateStatus();
      const interval = setInterval(() => {
        pct += 10;
        if (pct >= 100) {
          clearInterval(interval);
          updateState = { status: "ready", version: "1.0.9", progress: 100, error: null };
          broadcastUpdateStatus();
        } else {
          updateState = { status: "downloading", version: "1.0.9", progress: pct, error: null };
          broadcastUpdateStatus();
        }
      }, 300);
      return { ok: true };
    }
  });

  ipcMain.handle("app:install-update", () => {
    if (app.isPackaged) {
      installUpdate();
    } else {
      log.info("Simulating app install - quitting");
      app.quit();
    }
    return { ok: true };
  });

  ipcMain.handle("app:confirm-close", async () => {
    isQuitting = true;
    try {
      log.info("App close confirmed, running cleanup...");
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
      await monitor.stop();
      await deviceService.markOffline();
      await localApiServer.stop();
    } catch (err) {
      log.error("Error during app close cleanup", { err: err.message });
    } finally {
      app.quit();
    }
    return { ok: true };
  });

  ipcMain.handle("titlebar:dim", (event, dim) => {
    if (mainWindow && !mainWindow.isDestroyed() && process.platform === "win32" && mainWindow.setTitleBarOverlay) {
      try {
        if (dim) {
          if (currentTheme === "login") {
            mainWindow.setTitleBarOverlay({
              color: "rgba(0, 0, 0, 0)",
              symbolColor: "rgba(255, 255, 255, 0.6)"
            });
          } else {
            mainWindow.setTitleBarOverlay({
              color: "#f8f9fb",
              symbolColor: "#8a8a8a"
            });
          }
        } else {
          if (currentTheme === "login") {
            mainWindow.setTitleBarOverlay({
              color: "rgba(0, 0, 0, 0)",
              symbolColor: "#ffffff"
            });
          } else {
            mainWindow.setTitleBarOverlay({
              color: "#f8f9fb",
              symbolColor: "#1a1a1a"
            });
          }
        }
      } catch (err) {
        log.error("Failed to set title bar overlay color dynamically", { err: err.message });
      }
    }
    return { ok: true };
  });

  ipcMain.handle("titlebar:set-theme", (event, theme) => {
    currentTheme = theme;
    if (mainWindow && !mainWindow.isDestroyed() && process.platform === "win32" && mainWindow.setTitleBarOverlay) {
      try {
        if (theme === "login") {
          mainWindow.setTitleBarOverlay({
            color: "rgba(0, 0, 0, 0)",
            symbolColor: "#ffffff"
          });
        } else {
          mainWindow.setTitleBarOverlay({
            color: "#f8f9fb",
            symbolColor: "#1a1a1a"
          });
        }
      } catch (err) {
        log.error("Failed to set title bar overlay theme", { err: err.message });
      }
    }
    return { ok: true };
  });
}

// Cleanup on app quit
app.on("before-quit", async () => {
  isAppQuitting = true;
  if (authServer) {
    log.info("closing auth server");
    authServer.close();
    authServer = null;
  }
});

app.whenReady().then(async () => {
  log.info("agent starting", {
    apiBaseUrl: config.apiBaseUrl,
    intervalMs: config.metricsIntervalMs,
  });

  if (process.platform === "win32") {
    app.setAppUserModelId("com.vlinked.vlinked");
  }

  await localApiServer.start();
  setupIpc();
  createWindow();

  if (process.platform === "darwin") {
    try {
      const iconPath = path.join(__dirname, "vorcelogo", "Vlinked.png");
      const image = nativeImage.createFromPath(iconPath);
      if (!image.isEmpty()) {
        app.dock.setIcon(image);
      } else {
        log.warn("macOS dock icon image is empty or not found at path", { iconPath });
      }
    } catch (err) {
      log.error("Failed to set macOS dock icon", { err: err.message });
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", async () => {
  await monitor.stop();
  await deviceService.markOffline();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", async () => {
  await monitor.stop();
  await deviceService.markOffline();
  await localApiServer.stop();
  if (authServer) { authServer.close(); authServer = null; }
});
