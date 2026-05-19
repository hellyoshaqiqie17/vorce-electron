"use strict";

const { initializeApp, getApps, getApp } = require("firebase/app");
const {
  getAuth,
  GoogleAuthProvider,
  signInWithCredential,
  signOut,
  onAuthStateChanged,
} = require("firebase/auth");
const { getFirestore } = require("firebase/firestore");
const { getDatabase } = require("firebase/database");
const config = require("../core/config");
const { make } = require("../utils/logger");

const log = make("firebaseClient");

let authInstance = null;
let dbInstance = null;
let realtimeDbInstance = null;

function initFirebase() {
  const app = getApps().length ? getApp() : initializeApp(config.firebase);
  if (!authInstance) authInstance = getAuth(app);
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
  signInWithGoogleCredential,
  waitForAuthenticatedUser,
  signOutFirebase,
};
