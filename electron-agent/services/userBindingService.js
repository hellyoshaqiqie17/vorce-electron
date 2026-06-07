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
  const user = await firebaseClient.waitForAuthenticatedUser();
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

  // ===== VALIDASI DEVICE LIMIT (Cara A) =====
  const companySnap = await getDoc(doc(db, "companies", companyId));
  if (companySnap.exists()) {
    const companyData = companySnap.data() || {};
    
    // === TESTING MODE (Ubah MOCK_TESTING jadi true untuk mencoba) ===
    const MOCK_TESTING = false; // Set ke false kalau sudah selesai testing!
    
    let maxDevice, totalActiveDevice;
    if (MOCK_TESTING) {
      maxDevice = 1;         // Pura-puranya batasnya 1
      totalActiveDevice = 2; // Pura-puranya yang aktif sudah 2 (Lebih dari batas)
    } else {
      maxDevice = companyData.max_devices ?? companyData.max_device ?? companyData.maxDevices ?? 0;
      totalActiveDevice = companyData.total_active_devices ?? companyData.total_active_device ?? companyData.totalActiveDevices ?? 0;
    }
    // ================================================================

    // Lakukan validasi jika maxDevice memiliki nilai (ada batasannya)
    // Catatan: Anda mungkin perlu menambahkan pengecekan tambahan jika user ini *sudah* terhitung aktif, 
    // namun sebagai validasi dasar, ini cukup menolak masuk jika kuota penuh.
    // === VALIDASI DINONAKTIFKAN SEMENTARA ===
    /*
    if (maxDevice > 0 && totalActiveDevice >= maxDevice) {
      log.warn("Device limit reached", {
        companyId,
        maxDevice,
        totalActiveDevice
      });
      
      const limitError = new Error("ERR_DEVICE_LIMIT_REACHED");
      limitError.code = "ERR_DEVICE_LIMIT_REACHED";
      limitError.userMessage = "Kapasitas perangkat perusahaan sudah mencapai batas maksimum.";
      throw limitError;
    }
    */
  }
  // ==========================================

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

  log.info("user binding resolved", {
    userId: binding.userId,
    companyId: binding.companyId,
  });

  return binding;
}

module.exports = {
  getAuthenticatedBinding,
};
