"use strict";

const {
  doc,
  getDoc,
  collection,
  query,
  where,
  limit,
  getDocs,
} = require("firebase/firestore");
const firebaseClient = require("../firebase/firebaseClient");
const tokenStore = require("./tokenStore");
const { make } = require("../utils/logger");

const log = make("userBindingService");

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

async function readUserProfileByUid(db, uid) {
  const snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

async function readUserProfileByEmail(db, email) {
  if (!email) return null;
  const normalizedEmail = String(email).trim().toLowerCase();

  const directSnap = await getDoc(doc(db, "users", normalizedEmail));
  if (directSnap.exists()) return { id: directSnap.id, ...directSnap.data() };

  const q = query(collection(db, "users"), where("email", "==", normalizedEmail), limit(1));
  const snaps = await getDocs(q);
  if (snaps.empty) {
    const userEmailQuery = query(collection(db, "users"), where("userEmail", "==", normalizedEmail), limit(1));
    const userEmailSnaps = await getDocs(userEmailQuery);
    if (userEmailSnaps.empty) return null;
    const snap = userEmailSnaps.docs[0];
    return { id: snap.id, ...snap.data() };
  }
  const snap = snaps.docs[0];
  return { id: snap.id, ...snap.data() };
}

async function readCompanyName(db, companyId, profileCompanyName) {
  if (profileCompanyName) return profileCompanyName;
  if (!companyId) return "";

  const snap = await getDoc(doc(db, "companies", companyId));
  if (!snap.exists()) return "";

  const data = snap.data() || {};
  return firstString(
    data.companyName,
    data.name,
    data.displayName,
    data.organizationName,
    data.namaPerusahaan
  );
}

async function getAuthenticatedBinding() {
  let user = null;
  try {
    user = await firebaseClient.waitForAuthenticatedUser();
  } catch (err) {
    const cached = tokenStore.getCachedSession();
    if (cached?.uid && cached?.companyId) {
      log.warn("Using cached session binding because Firebase user is not yet hydrated", { uid: cached.uid });
      return {
        userId: cached.userId || cached.uid,
        companyId: cached.companyId,
        companyName: cached.companyName || "Vlinked",
        email: cached.email || "",
        displayName: cached.displayName || cached.email || "",
        firebaseUid: cached.uid,
      };
    }
    throw err;
  }

  try {
    const db = firebaseClient.getDb();
    const profile =
      (await readUserProfileByUid(db, user.uid)) ||
      (await readUserProfileByEmail(db, user.email || ""));

    if (!profile) {
      throw new Error(`Profil user tidak ditemukan di collection users untuk uid=${user.uid}, email=${user.email || "-"}.`);
    }

    const companyId = firstString(
      profile.companyId,
      profile.idCompany,
      profile.company,
      profile.company_id,
      profile.companyID,
      profile.company?.id,
      profile.company?.companyId
    );

    if (!companyId) {
      throw new Error("Profil user tidak memiliki companyId.");
    }

    const userId = user.uid;
    const email = firstString(profile.email, profile.userEmail, profile.id, user.email);
    const displayName = firstString(
      profile.displayName,
      profile.name,
      profile.fullName,
      profile.nama,
      profile.namaLengkap,
      profile.username,
      user.displayName,
      email
    );
    const profileCompanyName = firstString(
      profile.companyName,
      profile.company?.name,
      profile.company?.companyName,
      profile.organizationName
    );
    const companyName = await readCompanyName(db, companyId, profileCompanyName);

    const binding = {
      userId,
      companyId,
      companyName,
      email,
      displayName,
      firebaseUid: user.uid,
    };

    tokenStore.setCachedSession({
      uid: user.uid,
      userId: binding.userId,
      email: binding.email,
      displayName: binding.displayName,
      companyId: binding.companyId,
      companyName: binding.companyName || "Vlinked",
      hasToken: true,
    });

    log.info("user binding resolved", {
      userId: binding.userId,
      companyId: binding.companyId,
    });

    return binding;
  } catch (err) {
    const cached = tokenStore.getCachedSession();
    if (cached?.companyId && (cached?.uid === user.uid || cached?.email === user.email)) {
      log.warn("Firestore binding lookup failed at startup; using cached binding", { err: err.message });
      return {
        userId: user.uid,
        companyId: cached.companyId,
        companyName: cached.companyName || "Vlinked",
        email: cached.email || user.email || "",
        displayName: cached.displayName || user.displayName || cached.email || "",
        firebaseUid: user.uid,
      };
    }
    throw err;
  }
}

module.exports = {
  getAuthenticatedBinding,
};
