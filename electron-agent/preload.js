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
  ],
  on: [
    "auth:login-success",
    "auth:login-error",
    "monitor:sample",
    "monitor:status-changed",
    "device:info",
  ],
};

function ensure(channel, allowed) {
  if (!allowed.includes(channel)) {
    throw new Error(`IPC channel not allowed: ${channel}`);
  }
}

contextBridge.exposeInMainWorld("vorceAgent", {
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
