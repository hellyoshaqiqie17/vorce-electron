"use strict";

/**
 * Authentication — uses the EXISTING VORCE backend login endpoint.
 *
 *   POST /auth/login  { email, password }
 *
 * The backend response is the single source of truth for userId and
 * companyId. We never store or transmit those fields client-side;
 * they live inside the bearer token (JWT) and the backend re-derives
 * them on every subsequent request.
 */

const config = require("../core/config");
const api = require("./apiClient");
const tokenStore = require("./tokenStore");
const { make } = require("../utils/logger");

const log = make("authService");

async function login({ email, password }) {
  if (!email || !password) {
    throw new Error("Email dan password wajib diisi.");
  }

  const data = await api.post(
    config.endpoints.login,
    { email, password },
    { auth: false }
  );

  const token = data && (data.token || data.accessToken || data.access_token);
  if (!token) {
    throw new Error("Server tidak mengembalikan token autentikasi.");
  }

  tokenStore.saveToken(token);
  tokenStore.setDisplayEmail(email);

  log.info("login ok");

  return {
    email,
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
  login,
  logout,
  isLoggedIn,
  currentSession,
};
