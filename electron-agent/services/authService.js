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

const tokenStore = require("./tokenStore");
const firebaseClient = require("../firebase/firebaseClient");
const userBindingService = require("./userBindingService");
const deviceService = require("./deviceService");
const { make } = require("../utils/logger");

const log = make("authService");

async function loginWithGoogle({ oauthIdToken, oauthAccessToken }) {
  const user = await firebaseClient.signInWithGoogleCredential({
    oauthIdToken,
    oauthAccessToken,
  });
  const token = await user.getIdToken();
  const binding = await userBindingService.getAuthenticatedBinding();

  tokenStore.saveToken(token);
  tokenStore.setDisplayEmail(binding.email || user.email || "");

  log.info("login ok (google)");

  return {
    email: binding.email || user.email || "",
    displayName: binding.displayName || user.displayName || "",
    companyId: binding.companyId,
    companyName: binding.companyName,
    hasToken: true,
  };
}

function isLoggedIn() {
  return Boolean(firebaseClient.getCurrentUser());
}

async function logout() {
  await deviceService.markOffline();
  await firebaseClient.signOutFirebase();
  tokenStore.clearToken();
  tokenStore.setDisplayEmail(null);
  deviceService.resetRegistrationState();
  log.info("logged out");
}

function currentSession() {
  const user = firebaseClient.getCurrentUser();
  return {
    email: user?.email || tokenStore.getDisplayEmail(),
    displayName: user?.displayName || "",
    hasToken: Boolean(user),
    deviceId: tokenStore.getDeviceId(),
    uid: user?.uid || "",
  };
}

module.exports = {
  loginWithGoogle,
  logout,
  isLoggedIn,
  currentSession,
};
