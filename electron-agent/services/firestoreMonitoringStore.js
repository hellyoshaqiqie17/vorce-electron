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
  const existingData = existing.exists() ? existing.data() : {};

  // Construct current hardware spec strings with brands for history comparison
  const brandCpu = [info.cpu?.manufacturer, info.cpu?.brand || info.cpuModel].filter(Boolean).join(" ").trim() || "Unknown CPU";
  const brandRam = `${info.ram?.totalGB || info.totalRam || 0} GB ${info.ram?.type || ""} (${info.ram?.manufacturer || "Unknown Brand"})`.trim();
  const brandGpu = [info.gpu?.vendor, info.gpu?.model].filter(Boolean).join(" ").trim() || "Unknown GPU";
  const brandSsd = info.disk ? `${info.disk.vendor || ""} ${info.disk.name || "Unknown SSD"} (${info.disk.sizeGB || 0} GB) ${info.disk.type || ""}`.trim().replace(/\s+/g, " ") : "Unknown SSD";
  const brandOs = [info.os, info.osVersion, info.osRelease].filter(Boolean).join(" ").trim() || "Unknown OS";
  const brandIp = `IP: ${info.network?.localIp || "N/A"} (MAC: ${info.network?.macAddress || "N/A"})`;

  // History update helper function
  function updateHistoryList(history, newValue) {
    const list = Array.isArray(history) ? [...history] : [];
    const entry = {
      timestamp: new Date(),
      value: newValue
    };
    if (list.length === 0) {
      list.push(entry);
    } else {
      const lastEntry = list[list.length - 1];
      if (lastEntry.value !== newValue) {
        list.push(entry);
      }
    }
    return list;
  }

  const cpuHistory = updateHistoryList(existingData.cpuHistory, brandCpu);
  const ramHistory = updateHistoryList(existingData.ramHistory, brandRam);
  const gpuHistory = updateHistoryList(existingData.gpuHistory, brandGpu);
  const ssdHistory = updateHistoryList(existingData.ssdHistory, brandSsd);
  const osHistory = updateHistoryList(existingData.osHistory, brandOs);
  const networkHistory = updateHistoryList(existingData.networkHistory, brandIp);

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
      type: info.ram?.type || "",
      clockSpeed: Number(info.ram?.clockSpeed) || 0,
      manufacturer: info.ram?.manufacturer || "",
    },
    gpu: {
      vendor: info.gpu?.vendor || "",
      model: info.gpu?.model || "",
      vramMB: Number(info.gpu?.vramMB) || 0,
    },
    disk: info.disk || {
      type: "",
      name: "",
      vendor: "",
      sizeGB: 0,
      interfaceType: ""
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
    cpuHistory,
    ramHistory,
    gpuHistory,
    ssdHistory,
    osHistory,
    networkHistory,
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
