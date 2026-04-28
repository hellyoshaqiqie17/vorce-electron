"use strict";

/**
 * Preload script — the only bridge between the sandboxed renderer and the
 * Electron main process. Everything exposed here is whitelisted; the
 * renderer can never freely import Node modules, touch the filesystem, or
 * call the network on its own.
 *
 *   contextIsolation: true   (set in main.js)
 *   nodeIntegration:  false  (set in main.js)
 *   sandbox:          true   (set in main.js)
 */

const { contextBridge, ipcRenderer } = require("electron");

const channels = {
  invoke: [
    "auth:login",
    "auth:logout",
    "auth:session",
    "device:register",
    "monitor:start",
    "monitor:stop",
    "monitor:status",
  ],
  on: ["monitor:sample", "monitor:status-changed"],
};

function ensure(channel, allowed) {
  if (!allowed.includes(channel)) {
    throw new Error(`IPC channel not allowed: ${channel}`);
  }
}

contextBridge.exposeInMainWorld("vorceAgent", {
  // request/response style — Promise<result>
  invoke: (channel, payload) => {
    ensure(channel, channels.invoke);
    return ipcRenderer.invoke(channel, payload);
  },
  // event stream from main → renderer (e.g. live samples)
  on: (channel, listener) => {
    ensure(channel, channels.on);
    const subscription = (_event, data) => listener(data);
    ipcRenderer.on(channel, subscription);
    return () => ipcRenderer.removeListener(channel, subscription);
  },
});
