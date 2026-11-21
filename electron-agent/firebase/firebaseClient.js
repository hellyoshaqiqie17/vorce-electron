"use strict";

const { initializeApp, getApps, getApp } = require("firebase/app");
const { getFirestore } = require("firebase/firestore");
const { getDatabase } = require("firebase/database");
const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");

const config = require("../core/config");
const { make } = require("../utils/logger");
const tokenStore = require("../services/tokenStore");

const log = make("firebaseClient");

// Resolve absolute path to the react-native entry point of @firebase/auth
// to get access to getReactNativePersistence
const authPath = path.resolve(__dirname, "../node_modules/@firebase/auth/dist/rn/index.js");
const {
  initializeAuth,
  getReactNativePersistence,
  onAuthStateChanged,
  onIdTokenChanged,
  GoogleAuthProvider,
  signInWithCredential,
  signOut,
} = require(authPath);

let authInstance = null;
let dbInstance = null;
let realtimeDbInstance = null;
let authReadyPromise = null;
let storageWriteQueue = Promise.resolve();

function getStoragePath() {
  return path.join(app.getPath("userData"), "vlinked-auth-session.bin");
}

function getBackupJsonPath() {
  return path.join(app.getPath("userData"), "vlinked-auth-session.json");
}

function safeStorageAvailable() {
  try {
    return safeStorage && safeStorage.isEncryptionAvailable();
  } catch (_) {
    return false;
  }
}

function readStorageMapSync() {
  const binPath = getStoragePath();
  const jsonPath = getBackupJsonPath();

  // 1. Try encrypted/primary bin file
  if (fs.existsSync(binPath)) {
    try {
      const fileContent = fs.readFileSync(binPath);
      if (safeStorageAvailable()) {
        try {
          const decrypted = safeStorage.decryptString(fileContent);
          const parsed = JSON.parse(decrypted);
          if (parsed && typeof parsed === "object") return parsed;
        } catch (_) {
          const parsed = JSON.parse(fileContent.toString("utf8"));
          if (parsed && typeof parsed === "object") return parsed;
        }
      } else {
        const parsed = JSON.parse(fileContent.toString("utf8"));
        if (parsed && typeof parsed === "object") return parsed;
      }
    } catch (e) {
      log.warn("Primary auth session bin unreadable, trying backup JSON", { err: e.message });
    }
  }

  // 2. Fallback to plaintext JSON backup in userData (handles DPAPI/Keychain context shifts across OS restarts)
  if (fs.existsSync(jsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      if (parsed && typeof parsed === "object") return parsed;
    } catch (e) {
      log.warn("Backup auth session JSON unreadable", { err: e.message });
    }
  }

  return {};
}

function writeStorageMapSync(data) {
  const binPath = getStoragePath();
  const jsonPath = getBackupJsonPath();
  const dir = path.dirname(binPath);
  if (!fs.existsSync(dir)) {
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
  }

  const serialized = JSON.stringify(data);

  // Always write JSON backup so power loss or OS keyring lock at boot never breaks auto-login
  try {
    fs.writeFileSync(jsonPath, serialized, "utf8");
  } catch (e) {
    log.warn("Failed to write backup auth session JSON", { err: e.message });
  }

  try {
    if (safeStorageAvailable()) {
      const encrypted = safeStorage.encryptString(serialized);
      fs.writeFileSync(binPath, encrypted);
    } else {
      fs.writeFileSync(binPath, Buffer.from(serialized, "utf8"));
    }
  } catch (e) {
    log.error("Failed to write customStorage bin state", { err: e.message });
  }
}

// Custom storage provider with serialized write queue
const customStorage = {
  async getItem(key) {
    await storageWriteQueue;
    try {
      const data = readStorageMapSync();
      return data[key] ?? null;
    } catch (_) {
      return null;
    }
  },

  async setItem(key, value) {
    storageWriteQueue = storageWriteQueue.then(() => {
      try {
        const data = readStorageMapSync();
        data[key] = value;
        writeStorageMapSync(data);
      } catch (e) {
        log.error("Failed to setItem in customStorage", { err: e.message });
      }
    });
    return storageWriteQueue;
  },

  async removeItem(key) {
    storageWriteQueue = storageWriteQueue.then(() => {
      try {
        const data = readStorageMapSync();
        if (key in data) {
          delete data[key];
          writeStorageMapSync(data);
        }
      } catch (e) {
        log.error("Failed to removeItem in customStorage", { err: e.message });
      }
    });
    return storageWriteQueue;
  },
};

function initFirebase() {
  const appInstance = getApps().length ? getApp() : initializeApp(config.firebase);
  if (!authInstance) {
    authInstance = initializeAuth(appInstance, {
      persistence: getReactNativePersistence(customStorage),
    });

    let initialAuthChecked = false;
    if (typeof authInstance.authStateReady === "function") {
      authInstance.authStateReady().then(() => {
        initialAuthChecked = true;
      }).catch(() => {
        initialAuthChecked = true;
      });
    } else {
      initialAuthChecked = true;
    }

    // Keep tokenStore in sync with Firebase ID Token changes/refreshes
    onIdTokenChanged(authInstance, async (user) => {
      if (user) {
        try {
          const token = await user.getIdToken();
          tokenStore.saveToken(token);
          tokenStore.setDisplayEmail(user.email || "");
          log.info("tokenStore updated via onIdTokenChanged", { email: user.email });
        } catch (err) {
          log.error("Failed to update tokenStore in onIdTokenChanged", { err: err.message });
        }
      } else if (initialAuthChecked && !tokenStore.loadAuthCredentials()) {
        tokenStore.clearToken();
        tokenStore.setDisplayEmail(null);
        log.info("tokenStore cleared via onIdTokenChanged");
      }
    });
  }
  if (!dbInstance) dbInstance = getFirestore(appInstance);
  if (!realtimeDbInstance) realtimeDbInstance = getDatabase(appInstance);
  return { app: appInstance, auth: authInstance, db: dbInstance, realtimeDb: realtimeDbInstance };
}

function getAuthInstance() {
  return initFirebase().auth;
}

function getDb() {
  return initFirebase().db;
}

function getRealtimeDb() {
  return initFirebase().realtimeDb;
}

function getCurrentUser() {
  return getAuthInstance().currentUser || null;
}

async function tryRestoreFromSavedCredentials(auth) {
  if (auth.currentUser) return auth.currentUser;

  const savedCreds = tokenStore.loadAuthCredentials();
  if (!savedCreds) return null;

  // Attempt 1: Re-sign in with saved Google OAuth credential if present
  if (savedCreds.oauthIdToken || savedCreds.oauthAccessToken) {
    try {
      log.info("Attempting fallback Firebase sign-in using cached OAuth credential...");
      const credential = GoogleAuthProvider.credential(
        savedCreds.oauthIdToken || null,
        savedCreds.oauthAccessToken || null
      );
      const res = await signInWithCredential(auth, credential);
      if (res?.user) {
        log.info("Restored Firebase user from cached OAuth credential", { uid: res.user.uid });
        return res.user;
      }
    } catch (err) {
      log.warn("Cached OAuth credential sign-in failed (may be expired)", { err: err.message });
    }
  }

  return auth.currentUser || null;
}

function getAuthReadyPromise() {
  if (authReadyPromise) return authReadyPromise;

  // Ensure initialized
  initFirebase();

  const auth = getAuthInstance();
  authReadyPromise = (async () => {
    try {
      if (typeof auth.authStateReady === "function") {
        await auth.authStateReady();
      } else {
        await new Promise((resolve) => {
          const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();
            resolve(user);
          });
        });
      }

      // Give customStorage hydration a brief window if currentUser is still null
      if (!auth.currentUser) {
        await new Promise((r) => setTimeout(r, 250));
      }

      if (!auth.currentUser) {
        await tryRestoreFromSavedCredentials(auth);
      }
    } catch (err) {
      log.error("Error waiting for authStateReady", { err: err.message });
    }
    return auth.currentUser;
  })();

  return authReadyPromise;
}

async function signInWithGoogleCredential({ oauthIdToken, oauthAccessToken, refreshToken, email, displayName, localId }) {
  if (!oauthIdToken && !oauthAccessToken) {
    throw new Error("Google OAuth credential tidak tersedia untuk Firebase SDK sign-in.");
  }

  const auth = getAuthInstance();
  const credential = GoogleAuthProvider.credential(
    oauthIdToken || null,
    oauthAccessToken || null
  );
  const result = await signInWithCredential(auth, credential);
  await storageWriteQueue;

  tokenStore.saveAuthCredentials({
    oauthIdToken: oauthIdToken || "",
    oauthAccessToken: oauthAccessToken || "",
    refreshToken: refreshToken || result.user?.refreshToken || "",
    uid: result.user?.uid || localId || "",
    email: result.user?.email || email || "",
    displayName: result.user?.displayName || displayName || "",
    savedAt: Date.now(),
  });

  log.info("firebase auth signed in & credentials persisted", { uid: result.user.uid });
  return result.user;
}

function waitForAuthenticatedUser(timeoutMs = 15000) {
  const current = getCurrentUser();
  if (current) return Promise.resolve(current);

  const auth = getAuthInstance();
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(async () => {
      if (settled) return;
      unsubscribe();
      const restored = await tryRestoreFromSavedCredentials(auth);
      if (restored) {
        settled = true;
        resolve(restored);
        return;
      }
      settled = true;
      reject(new Error("Firebase user belum terautentikasi."));
    }, timeoutMs);

    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (!user || settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(user);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        reject(err);
      }
    );
  });
}

async function signOutFirebase() {
  tokenStore.clearAuthCredentials();
  tokenStore.setCachedSession(null);
  try {
    const binPath = getStoragePath();
    const jsonPath = getBackupJsonPath();
    if (fs.existsSync(binPath)) fs.unlinkSync(binPath);
    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);
  } catch (_) {}
  await signOut(getAuthInstance());
  log.info("firebase auth signed out and storage cleared");
}

module.exports = {
  initFirebase,
  getAuthInstance,
  getDb,
  getRealtimeDb,
  getCurrentUser,
  getAuthReadyPromise,
  signInWithGoogleCredential,
  waitForAuthenticatedUser,
  signOutFirebase,
};
