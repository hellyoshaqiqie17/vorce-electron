"use strict";

const {
  doc,
  collection,
  setDoc,
  addDoc,
  getDoc,
  serverTimestamp,
} = require("firebase/firestore");
const firebaseClient = require("../firebase/firebaseClient");
const { make } = require("../utils/logger");

const log = make("firestoreMonitoringStore");

function getDeviceRef(companyId, deviceId) {
  if (!companyId) throw new Error("companyId belum tersedia.");
  if (!deviceId) throw new Error("deviceId belum tersedia.");
  return doc(firebaseClient.getDb(), "companies", companyId, "device_monitoring", deviceId);
}

function getMetricsRef(companyId, deviceId) {
  if (!companyId) throw new Error("companyId belum tersedia.");
  if (!deviceId) throw new Error("deviceId belum tersedia.");
  return collection(firebaseClient.getDb(), "companies", companyId, "device_monitoring", deviceId, "live_metrics");
}

function getActivitySessionsRef(companyId, deviceId) {
  if (!companyId) throw new Error("companyId belum tersedia.");
  if (!deviceId) throw new Error("deviceId belum tersedia.");
  return collection(firebaseClient.getDb(), "companies", companyId, "device_monitoring", deviceId, "activity_sessions");
}

async function upsertDevice({ deviceId, binding, info, status = "online" }) {
  const ref = getDeviceRef(binding.companyId, deviceId);
  const existing = await getDoc(ref);
  const payload = {
    deviceId,
    userId: binding.userId,
    companyId: binding.companyId,
    userName: binding.displayName || "",
    userEmail: binding.email || "",
    companyName: binding.companyName || "",
    hostname: info.hostname || "",
    machineId: info.machineId || "",
    platform: info.platform || "",
    arch: info.arch || "",
    os: info.os || "",
    osVersion: info.osVersion || "",
    osRelease: info.osRelease || "",
    kernel: info.kernel || "",
    cpu: {
      manufacturer: info.cpu?.manufacturer || "",
      brand: info.cpu?.brand || info.cpuModel || "",
      physicalCores: Number(info.cpu?.physicalCores) || 0,
      logicalCores: Number(info.cpu?.logicalCores) || 0,
      speedGHz: Number(info.cpu?.speedGHz) || 0,
    },
    ram: {
      totalGB: Number(info.ram?.totalGB ?? info.totalRam) || 0,
    },
    gpu: {
      vendor: info.gpu?.vendor || "",
      model: info.gpu?.model || "",
      vramMB: Number(info.gpu?.vramMB) || 0,
    },
    battery: {
      hasBattery: Boolean(info.battery?.hasBattery),
      percent: Number(info.battery?.percent) || 0,
      charging: Boolean(info.battery?.charging),
    },
    network: {
      localIp: info.network?.localIp || "",
      macAddress: info.network?.macAddress || "",
    },
    lastSeen: serverTimestamp(),
    status,
    updatedAt: serverTimestamp(),
  };

  await setDoc(
    ref,
    {
      ...payload,
      ...(existing.exists() ? {} : { createdAt: serverTimestamp() }),
    },
    { merge: true }
  );

  log.info("device document upserted", {
    companyId: binding.companyId,
    deviceId,
  });

  return payload;
}

async function appendMetric({ deviceId, binding, metric }) {
  const metricsRef = getMetricsRef(binding.companyId, deviceId);
  const metricRef = await addDoc(metricsRef, metric);
  await setDoc(
    getDeviceRef(binding.companyId, deviceId),
    {
      lastSeen: serverTimestamp(),
      status: "online",
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  log.debug("metric document written", { id: metricRef.id });
  return metricRef.id;
}

async function updateDeviceStatus({ deviceId, binding, status }) {
  if (!deviceId || !binding?.companyId) return;
  await setDoc(
    getDeviceRef(binding.companyId, deviceId),
    {
      lastSeen: serverTimestamp(),
      status,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

async function heartbeat({ deviceId, binding }) {
  if (!deviceId || !binding?.companyId) return;
  await setDoc(
    getDeviceRef(binding.companyId, deviceId),
    {
      lastSeen: serverTimestamp(),
      status: "online",
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

async function upsertActivitySession({ deviceId, binding, session }) {
  if (!session?.sessionId) throw new Error("sessionId belum tersedia.");
  const ref = doc(getActivitySessionsRef(binding.companyId, deviceId), session.sessionId);
  await setDoc(
    ref,
    {
      ...session,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  await heartbeat({ deviceId, binding });
  log.debug("activity session upserted", { id: session.sessionId });
  return session.sessionId;
}

module.exports = {
  getDeviceRef,
  getMetricsRef,
  getActivitySessionsRef,
  upsertDevice,
  appendMetric,
  updateDeviceStatus,
  heartbeat,
  upsertActivitySession,
};
