"use strict";

/**
 * Authentication — uses Google Sign-In via Firebase, then authenticates
 * with the EXISTING VORCE backend.
 *
 *   POST /api/Login/login-google-admin  { idToken, deviceInfo }
 *
 * The backend response is the single source of truth for userId and
 * companyId. We never store or transmit those fields client-side.
 */

const os = require("os");
const config = require("../core/config");
const api = require("./apiClient");
const tokenStore = require("./tokenStore");
const { make } = require("../utils/logger");

const log = make("authService");

function getDeviceInfo() {
  const platform = os.platform();
  const osName =
    platform === "win32"
      ? "Windows"
      : platform === "darwin"
        ? "macOS"
        : "Linux";
  return `Electron Agent (${osName})`;
}

async function loginWithGoogle({ idToken, email }) {
  if (!idToken) {
    throw new Error("Firebase ID token tidak tersedia.");
  }

  const deviceInfo = getDeviceInfo();

  const data = await api.post(
    config.endpoints.loginGoogle,
    { idToken, deviceInfo },
    { auth: false }
  );

  const token = data && (data.token || data.accessToken || data.access_token);
  if (!token) {
    throw new Error("Server tidak mengembalikan token autentikasi.");
  }

  tokenStore.saveToken(token);
  tokenStore.setDisplayEmail(email || "");

  log.info("login ok (google)");

  return {
    email: email || "",
    hasToken: true,
  };
}

function isLoggedIn() {
  return Boolean(tokenStore.loadToken());
}

function logout() {
  tokenStore.clearToken();
  tokenStore.clearDeviceId();
  tokenStore.setDisplayEmail(null);
  log.info("logged out");
}

function currentSession() {
  return {
    email: tokenStore.getDisplayEmail(),
    hasToken: isLoggedIn(),
    deviceId: tokenStore.getDeviceId(),
  };
}

module.exports = {
  loginWithGoogle,
  logout,
  isLoggedIn,
  currentSession,
};
