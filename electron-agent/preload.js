"use strict";

/**
 * Preload script — the only bridge between the sandboxed renderer and the
 * Electron main process.
 *
 *   contextIsolation: true
 *   nodeIntegration:  false
 *   sandbox:          true
 */

const { contextBridge, ipcRenderer } = require("electron");

const channels = {
  invoke: [
    "auth:open-google",
    "auth:open-apple",
    "auth:logout",
    "auth:session",
    "device:register",
    "monitor:start",
    "monitor:stop",
    "monitor:status",
    "device:get-history",
    "permissions:check",
    "permissions:request-accessibility",
    "permissions:request-automation",
    "permissions:request-screen-recording",
    "permissions:bypass",
    "app:get-version",
    "app:check-update",
    "app:download-update",
    "app:install-update",
    "app:confirm-close",
    "titlebar:dim",
    "titlebar:set-theme",
  ],
  on: [
    "auth:login-success",
    "auth:login-error",
    "monitor:sample",
    "monitor:status-changed",
    "device:info",
    "update:status",
    "app:request-close",
  ],
};

function ensure(channel, allowed) {
  if (!allowed.includes(channel)) {
    throw new Error(`IPC channel not allowed: ${channel}`);
  }
}

contextBridge.exposeInMainWorld("vlinkedAgent", {
  invoke: (channel, payload) => {
    ensure(channel, channels.invoke);
    return ipcRenderer.invoke(channel, payload);
  },
  on: (channel, listener) => {
    ensure(channel, channels.on);
    const subscription = (_event, data) => listener(data);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
});
