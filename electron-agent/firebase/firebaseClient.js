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

function getStoragePath() {
  return path.join(app.getPath("userData"), "vlinked-auth-session.bin");
}

function safeStorageAvailable() {
  try {
    return safeStorage && safeStorage.isEncryptionAvailable();
  } catch (_) {
    return false;
  }
}

// Custom storage provider using Electron's safeStorage (or plaintext fallback)
const customStorage = {
  async getItem(key) {
    try {
      const p = getStoragePath();
      if (!fs.existsSync(p)) return null;
      const fileContent = fs.readFileSync(p);
      let data = {};
      if (safeStorageAvailable()) {
        try {
          const decrypted = safeStorage.decryptString(fileContent);
          data = JSON.parse(decrypted);
        } catch (e) {
          data = JSON.parse(fileContent.toString("utf8"));
        }
      } else {
        data = JSON.parse(fileContent.toString("utf8"));
      }
      return data[key] || null;
    } catch (e) {
      return null;
    }
  },

  async setItem(key, value) {
    try {
      const p = getStoragePath();
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
      }
      let data = {};
      if (fs.existsSync(p)) {
        const fileContent = fs.readFileSync(p);
        if (safeStorageAvailable()) {
          try {
            const decrypted = safeStorage.decryptString(fileContent);
            data = JSON.parse(decrypted);
          } catch (_) {
            data = JSON.parse(fileContent.toString("utf8"));
          }
        } else {
          data = JSON.parse(fileContent.toString("utf8"));
        }
      }
      data[key] = value;
      const serialized = JSON.stringify(data);
      if (safeStorageAvailable()) {
        const encrypted = safeStorage.encryptString(serialized);
        fs.writeFileSync(p, encrypted);
      } else {
        fs.writeFileSync(p, Buffer.from(serialized, "utf8"));
      }
    } catch (e) {
      log.error("Failed to write customStorage state", { err: e.message });
    }
  },

  async removeItem(key) {
    try {
      const p = getStoragePath();
      const dir = path.dirname(p);
      if (!fs.existsSync(dir)) {
        try { fs.mkdirSync(dir, { recursive: true }); } catch (_) {}
      }
      if (!fs.existsSync(p)) return;
      const fileContent = fs.readFileSync(p);
      let data = {};
      if (safeStorageAvailable()) {
        try {
          const decrypted = safeStorage.decryptString(fileContent);
          data = JSON.parse(decrypted);
        } catch (_) {
          data = JSON.parse(fileContent.toString("utf8"));
        }
      } else {
        data = JSON.parse(fileContent.toString("utf8"));
      }
      delete data[key];
      const serialized = JSON.stringify(data);
      if (safeStorageAvailable()) {
        const encrypted = safeStorage.encryptString(serialized);
        fs.writeFileSync(p, encrypted);
      } else {
        fs.writeFileSync(p, Buffer.from(serialized, "utf8"));
      }
    } catch (e) {
      log.error("Failed to remove customStorage key", { err: e.message });
    }
  }
};

function initFirebase() {
  const app = getApps().length ? getApp() : initializeApp(config.firebase);
  if (!authInstance) {
    authInstance = initializeAuth(app, {
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
      } else if (initialAuthChecked) {
        tokenStore.clearToken();
        tokenStore.setDisplayEmail(null);
        log.info("tokenStore cleared via onIdTokenChanged");
      }
    });
  }
  if (!dbInstance) dbInstance = getFirestore(app);
  if (!realtimeDbInstance) realtimeDbInstance = getDatabase(app);
  return { app, auth: authInstance, db: dbInstance, realtimeDb: realtimeDbInstance };
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
    } catch (err) {
      log.error("Error waiting for authStateReady", { err: err.message });
    }
    return auth.currentUser;
  })();

  return authReadyPromise;
}

async function signInWithGoogleCredential({ oauthIdToken, oauthAccessToken }) {
  if (!oauthIdToken && !oauthAccessToken) {
    throw new Error("Google OAuth credential tidak tersedia untuk Firebase SDK sign-in.");
  }

  const auth = getAuthInstance();
  const credential = GoogleAuthProvider.credential(
    oauthIdToken || null,
    oauthAccessToken || null
  );
  const result = await signInWithCredential(auth, credential);
  log.info("firebase auth signed in", { uid: result.user.uid });
  return result.user;
}

function waitForAuthenticatedUser(timeoutMs = 10000) {
  const current = getCurrentUser();
  if (current) return Promise.resolve(current);

  const auth = getAuthInstance();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsubscribe();
      reject(new Error("Firebase user belum terautentikasi."));
    }, timeoutMs);

    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (!user) return;
        clearTimeout(timer);
        unsubscribe();
        resolve(user);
      },
      (err) => {
        clearTimeout(timer);
        unsubscribe();
        reject(err);
      }
    );
  });
}

async function signOutFirebase() {
  await signOut(getAuthInstance());
  log.info("firebase auth signed out");
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
