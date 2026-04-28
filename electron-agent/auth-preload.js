"use strict";

/**
 * Preload for the Google Sign-In window.
 *
 * Exposes a minimal IPC bridge so the auth page can send the Firebase
 * ID token (or an error) back to the main process.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAuth", {
  sendToken: (idToken, email) =>
    ipcRenderer.send("google-auth:token", { idToken, email }),
  sendError: (error) => ipcRenderer.send("google-auth:error", { error }),
  getFirebaseConfig: () => ipcRenderer.invoke("google-auth:get-config"),
});
