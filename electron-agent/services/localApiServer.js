"use strict";

const crypto = require("crypto");
const express = require("express");
const { Timestamp } = require("firebase/firestore");
const firebaseClient = require("../firebase/firebaseClient");
const monitoringStore = require("./firestoreMonitoringStore");
const intelligenceStore = require("./firestoreIntelligenceStore");
const localApiClient = require("./localApiClient");
const { make } = require("../utils/logger");

const log = make("localApiServer");

let server = null;
let runtime = null;

function ensureAuthenticated(req, res, next) {
  const secret = req.get("X-VORCE-Agent-Secret");
  if (!runtime?.secret || secret !== runtime.secret) {
    res.status(401).json({ ok: false, error: "Unauthorized local API request." });
    return;
  }
  next();
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

async function requireFirebaseUser() {
  try {
    return await firebaseClient.waitForAuthenticatedUser();
  } catch (err) {
    err.status = 401;
    err.message = err.message || "Firebase user belum terautentikasi.";
    throw err;
  }
}

function normalizeMetric(metric) {
  const timestamp = Number(metric.timestamp);
  return {
    ...metric,
    timestamp: Number.isFinite(timestamp) && timestamp > 0
      ? Timestamp.fromMillis(timestamp * 1000)
      : Timestamp.fromDate(new Date()),
  };
}

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));
  app.use(ensureAuthenticated);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/device/register", asyncRoute(async (req, res) => {
    const { deviceId, binding, info, status = "online" } = req.body || {};
    if (!deviceId) {
      res.status(400).json({ ok: false, error: "deviceId wajib diisi." });
      return;
    }
    if (!binding?.companyId || !binding?.userId) {
      res.status(400).json({ ok: false, error: "binding user/company tidak lengkap." });
      return;
    }

    await requireFirebaseUser();
    const device = await monitoringStore.upsertDevice({
      deviceId,
      binding,
      info: info || {},
      status,
    });

    res.json({ ok: true, data: { deviceId, device } });
  }));

  app.post("/api/device/metrics", asyncRoute(async (req, res) => {
    const { deviceId, binding, metric } = req.body || {};
    if (!deviceId) {
      res.status(400).json({ ok: false, error: "deviceId wajib diisi." });
      return;
    }
    if (!binding?.companyId || !binding?.userId) {
      res.status(400).json({ ok: false, error: "binding user/company tidak lengkap." });
      return;
    }
    if (!metric) {
      res.status(400).json({ ok: false, error: "metric wajib diisi." });
      return;
    }

    await requireFirebaseUser();
    const metricId = await monitoringStore.appendMetric({
      deviceId,
      binding,
      metric: normalizeMetric(metric),
    });
    res.json({ ok: true, data: { metricId } });
  }));

  app.patch("/api/device/status", asyncRoute(async (req, res) => {
    const { deviceId, binding, status } = req.body || {};
    if (!deviceId || !binding?.companyId || !status) {
      res.status(400).json({ ok: false, error: "deviceId, binding, dan status wajib diisi." });
      return;
    }

    await requireFirebaseUser();
    await monitoringStore.updateDeviceStatus({ deviceId, binding, status });
    res.json({ ok: true });
  }));

  app.post("/api/device/heartbeat", asyncRoute(async (req, res) => {
    const { deviceId, binding } = req.body || {};
    if (!deviceId || !binding?.companyId) {
      res.status(400).json({ ok: false, error: "deviceId dan binding wajib diisi." });
      return;
    }

    await requireFirebaseUser();
    await monitoringStore.heartbeat({ deviceId, binding });
    res.json({ ok: true });
  }));

  app.post("/api/device/activity-session", asyncRoute(async (req, res) => {
    const { deviceId, binding, session } = req.body || {};
    if (!deviceId || !binding?.companyId || !binding?.userId) {
      res.status(400).json({ ok: false, error: "deviceId dan binding wajib diisi." });
      return;
    }
    if (!session?.sessionId) {
      res.status(400).json({ ok: false, error: "sessionId wajib diisi." });
      return;
    }

    await requireFirebaseUser();
    const sessionId = await monitoringStore.upsertActivitySession({ deviceId, binding, session });
    res.json({ ok: true, data: { sessionId } });
  }));

  // ---- Intelligence pipeline endpoints --------------------------------------

  app.post("/api/device/presence", asyncRoute(async (req, res) => {
    const { deviceId, binding, presence } = req.body || {};
    if (!deviceId || !binding?.companyId || !binding?.userId || !presence) {
      res.status(400).json({ ok: false, error: "deviceId, binding, presence wajib diisi." });
      return;
    }
    await requireFirebaseUser();
    await intelligenceStore.upsertPresence({ ...presence, deviceId, companyId: binding.companyId, userId: binding.userId });
    res.json({ ok: true });
  }));

  app.post("/api/device/session", asyncRoute(async (req, res) => {
    const { deviceId, binding, session } = req.body || {};
    if (!deviceId || !binding?.companyId || !binding?.userId || !session?.sessionId) {
      res.status(400).json({ ok: false, error: "deviceId, binding, session.sessionId wajib diisi." });
      return;
    }
    await requireFirebaseUser();
    await intelligenceStore.writeFinalizedSession({ ...session, deviceId, companyId: binding.companyId, userId: binding.userId });
    res.json({ ok: true, data: { sessionId: session.sessionId } });
  }));

  app.post("/api/device/snapshot", asyncRoute(async (req, res) => {
    const { deviceId, binding, snapshot } = req.body || {};
    if (!deviceId || !binding?.companyId || !binding?.userId || !snapshot?.snapshotId) {
      res.status(400).json({ ok: false, error: "deviceId, binding, snapshot.snapshotId wajib diisi." });
      return;
    }
    await requireFirebaseUser();
    await intelligenceStore.writeSnapshot({ ...snapshot, deviceId, companyId: binding.companyId, userId: binding.userId });
    res.json({ ok: true, data: { snapshotId: snapshot.snapshotId } });
  }));

  app.post("/api/device/anomaly", asyncRoute(async (req, res) => {
    const { deviceId, binding, event } = req.body || {};
    if (!deviceId || !binding?.companyId || !binding?.userId || !event?.eventId) {
      res.status(400).json({ ok: false, error: "deviceId, binding, event.eventId wajib diisi." });
      return;
    }
    await requireFirebaseUser();
    await intelligenceStore.writeAnomaly({ ...event, deviceId, companyId: binding.companyId, userId: binding.userId });
    res.json({ ok: true, data: { eventId: event.eventId } });
  }));

  // ---- Analytics aggregation endpoints --------------------------------------

  function analyticsHandler(writerFn) {
    return asyncRoute(async (req, res) => {
      const { binding, payload } = req.body || {};
      if (!binding?.companyId || !binding?.userId || !payload?.docId) {
        res.status(400).json({ ok: false, error: "binding dan payload.docId wajib diisi." });
        return;
      }
      await requireFirebaseUser();
      await writerFn({ ...payload, companyId: binding.companyId, userId: binding.userId });
      res.json({ ok: true, data: { docId: payload.docId } });
    });
  }

  app.post("/api/device/analytics/daily", analyticsHandler(intelligenceStore.incrementDailyAnalytics));
  app.post("/api/device/analytics/weekly", analyticsHandler(intelligenceStore.incrementWeeklyAnalytics));
  app.post("/api/device/analytics/monthly", analyticsHandler(intelligenceStore.incrementMonthlyAnalytics));

  app.use((err, _req, res, _next) => {
    log.error("local api request failed", { err: err.message });
    res.status(err.status || 500).json({ ok: false, error: err.message || "Local API error." });
  });

  return app;
}

async function start() {
  if (server && runtime) return runtime;

  runtime = {
    host: "127.0.0.1",
    port: 0,
    secret: crypto.randomBytes(32).toString("hex"),
  };

  const app = createApp();

  await new Promise((resolve, reject) => {
    server = app.listen(runtime.port, runtime.host, () => {
      const address = server.address();
      runtime.port = address.port;
      runtime.baseUrl = `http://${runtime.host}:${runtime.port}`;
      localApiClient.configure(runtime);
      log.info("local monitoring api listening", { baseUrl: runtime.baseUrl });
      resolve();
    });
    server.on("error", reject);
  });

  return runtime;
}

async function stop() {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
  server = null;
  runtime = null;
  localApiClient.configure(null);
  log.info("local monitoring api stopped");
}

function getRuntime() {
  return runtime;
}

module.exports = {
  start,
  stop,
  getRuntime,
};
