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

async function loginWithGoogle(authPayload) {
  const { oauthIdToken, oauthAccessToken, refreshToken, email, displayName, localId } = authPayload || {};
  const user = await firebaseClient.signInWithGoogleCredential({
    oauthIdToken,
    oauthAccessToken,
    refreshToken,
    email,
    displayName,
    localId,
  });
  const token = await user.getIdToken();
  const binding = await userBindingService.getAuthenticatedBinding();

  const resolvedEmail = binding.email || user.email || email || "";
  const resolvedDisplayName = binding.displayName || user.displayName || displayName || "";

  tokenStore.saveToken(token);
  tokenStore.setDisplayEmail(resolvedEmail);

  const sessionObj = {
    uid: user.uid,
    userId: binding.userId || user.uid,
    email: resolvedEmail,
    displayName: resolvedDisplayName,
    companyId: binding.companyId,
    companyName: binding.companyName,
    hasToken: true,
  };
  tokenStore.setCachedSession(sessionObj);

  log.info("login ok (google)", { email: resolvedEmail, companyId: binding.companyId });

  return sessionObj;
}

function isLoggedIn() {
  if (firebaseClient.getCurrentUser()) return true;
  const cached = tokenStore.getCachedSession();
  return Boolean(cached?.uid && cached?.companyId && (tokenStore.loadToken() || tokenStore.loadAuthCredentials()));
}

async function logout() {
  await deviceService.markOffline();
  await firebaseClient.signOutFirebase();
  tokenStore.clearToken();
  tokenStore.clearAuthCredentials();
  tokenStore.setCachedSession(null);
  tokenStore.setDisplayEmail(null);
  deviceService.resetRegistrationState();
  log.info("logged out");
}

function currentSession() {
  const user = firebaseClient.getCurrentUser();
  const cached = tokenStore.getCachedSession();
  const hasToken = Boolean(user) || Boolean(cached?.uid && (tokenStore.loadToken() || tokenStore.loadAuthCredentials()));

  return {
    email: user?.email || cached?.email || tokenStore.getDisplayEmail(),
    displayName: user?.displayName || cached?.displayName || "",
    hasToken,
    deviceId: tokenStore.getDeviceId(),
    uid: user?.uid || cached?.uid || "",
    companyId: cached?.companyId || "",
    companyName: cached?.companyName || "Vlinked",
  };
}

async function getSession() {
  await firebaseClient.getAuthReadyPromise();
  const user = firebaseClient.getCurrentUser();
  const cached = tokenStore.getCachedSession();

  if (!user && !(cached?.uid && cached?.companyId)) {
    return {
      email: tokenStore.getDisplayEmail(),
      displayName: "",
      hasToken: false,
      deviceId: tokenStore.getDeviceId(),
      uid: "",
      companyId: "",
      companyName: "",
    };
  }

  let binding = null;
  if (user) {
    try {
      binding = await userBindingService.getAuthenticatedBinding();
      if (binding) {
        tokenStore.setCachedSession({
          uid: user.uid,
          userId: binding.userId || user.uid,
          email: binding.email || user.email || cached?.email || "",
          displayName: binding.displayName || user.displayName || cached?.displayName || "",
          companyId: binding.companyId,
          companyName: binding.companyName || "Vlinked",
          hasToken: true,
        });
      }
    } catch (err) {
      log.warn("Failed to resolve binding from Firestore in getSession, falling back to cached session", { err: err.message });
    }
  }

  return {
    email: binding?.email || user?.email || cached?.email || tokenStore.getDisplayEmail(),
    displayName: binding?.displayName || user?.displayName || cached?.displayName || "",
    hasToken: true,
    deviceId: tokenStore.getDeviceId(),
    uid: user?.uid || cached?.uid || "",
    companyId: binding?.companyId || cached?.companyId || "",
    companyName: binding?.companyName || cached?.companyName || "Vlinked",
  };
}

module.exports = {
  loginWithGoogle,
  logout,
  isLoggedIn,
  currentSession,
  getSession,
};
