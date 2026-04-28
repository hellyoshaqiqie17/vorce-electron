"use strict";

/**
 * Authentication uses the existing VORCE backend.
 *
 *   POST /auth/login  { email, password }
 *
 * The backend response is the single source of truth for `userId` and
 * `companyId`. We deliberately ignore those fields client-side: they are
 * carried inside the bearer token (JWT) and re-derived by the backend on
 * every subsequent call. Storing them locally would create an opportunity
 * for the client to lie about ownership, which the spec forbids.
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
    { auth: false } // no token yet
  );

  const token = data && (data.token || data.accessToken || data.access_token);
  if (!token) {
    throw new Error("Server tidak mengembalikan token autentikasi.");
  }

  tokenStore.saveToken(token);
  tokenStore.setDisplayEmail(email);

  log.info("login ok");

  // Surface only what the renderer needs for UI; never pass userId/companyId
  // into business logic — those are the backend's concern.
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
