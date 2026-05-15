"use strict";

const mqtt = require("mqtt");
const config = require("../core/config");
const { make } = require("../utils/logger");

const log = make("mqttPresence");

let client = null;
let connected = false;
let currentIdentity = null;
let commandHandler = null;
let connectPromise = null;

function isEnabled() {
  return Boolean(config.mqtt?.enabled && config.mqtt?.brokerUrl);
}

function presenceTopic(companyId, deviceId) {
  return `vorce/${companyId}/devices/${deviceId}/presence`;
}

function commandTopic(companyId, deviceId) {
  return `vorce/${companyId}/devices/${deviceId}/commands`;
}

function broadcastAlertsTopic(companyId) {
  return `vorce/${companyId}/alerts`;
}

function normalizeState(state) {
  if (state === "idle" || state === "away" || state === "offline") return state;
  return "active";
}

function normalizePayload(payload) {
  return {
    deviceId: payload.deviceId,
    userId: payload.userId,
    userEmail: payload.userEmail || "",
    userName: payload.userName || "",
    companyId: payload.companyId,
    currentApp: payload.currentApp || "Unknown",
    currentCategory: payload.currentCategory || "unknown",
    activeWindow: payload.activeWindow || "",
    executable: payload.executable || "",
    cpuNow: Number(payload.cpuNow) || 0,
    ramNow: Number(payload.ramNow) || 0,
    state: normalizeState(payload.state),
    healthScore: Number(payload.healthScore) || 0,
    sessionId: payload.sessionId || null,
    timestamp: Date.now(),
  };
}

function handleMessage(topic, message) {
  try {
    const payload = JSON.parse(message.toString());
    log.info("command received", { topic, type: payload.type || "" });
    if (typeof commandHandler === "function") {
      commandHandler({ topic, payload });
    }
  } catch (err) {
    log.warn("command parse failed", { topic, err: err.message });
  }
}

async function connect(identity) {
  if (!isEnabled()) return false;
  if (!identity?.companyId || !identity?.deviceId || !identity?.userId) return false;

  const sameIdentity = currentIdentity &&
    currentIdentity.companyId === identity.companyId &&
    currentIdentity.deviceId === identity.deviceId &&
    currentIdentity.userId === identity.userId;

  if (client && sameIdentity) return connected;
  if (client && !sameIdentity) disconnect();

  currentIdentity = {
    companyId: identity.companyId,
    deviceId: identity.deviceId,
    userId: identity.userId,
  };

  if (connected && client) return true;
  if (connectPromise) return connectPromise;

  connectPromise = new Promise((resolve) => {
    const clientId = `vorce_electron_${currentIdentity.deviceId}_${Date.now()}`;
    client = mqtt.connect(config.mqtt.brokerUrl, {
      clientId,
      username: config.mqtt.username,
      password: config.mqtt.password,
      reconnectPeriod: config.mqtt.reconnectPeriodMs,
      connectTimeout: config.mqtt.connectTimeoutMs,
      clean: true,
      keepalive: 30,
    });

    let settled = false;

    client.on("connect", () => {
      connected = true;
      log.info("connected", { brokerUrl: config.mqtt.brokerUrl, clientId });

      const topics = [
        commandTopic(currentIdentity.companyId, currentIdentity.deviceId),
        broadcastAlertsTopic(currentIdentity.companyId),
      ];

      client.subscribe(topics, { qos: config.mqtt.qos }, (err) => {
        if (err) {
          log.warn("subscribe failed", { err: err.message });
        } else {
          log.info("subscribed", { topics });
        }
      });

      if (!settled) {
        settled = true;
        resolve(true);
      }
    });

    client.on("message", handleMessage);

    client.on("offline", () => {
      connected = false;
      log.warn("offline");
    });

    client.on("close", () => {
      connected = false;
    });

    client.on("error", (err) => {
      connected = false;
      log.warn("error", { err: err.message });
      if (!settled) {
        settled = true;
        resolve(false);
      }
    });
  }).finally(() => {
    connectPromise = null;
  });

  return connectPromise;
}

async function publishPresence(payload) {
  if (!isEnabled()) return false;

  const identity = {
    companyId: payload.companyId,
    deviceId: payload.deviceId,
    userId: payload.userId,
  };

  const ok = await connect(identity);
  if (!ok || !connected || !client) return false;

  const topic = presenceTopic(payload.companyId, payload.deviceId);
  const message = JSON.stringify(normalizePayload(payload));

  return new Promise((resolve) => {
    client.publish(topic, message, { qos: config.mqtt.qos, retain: false }, (err) => {
      if (err) {
        log.warn("publish failed", { err: err.message, topic });
        resolve(false);
        return;
      }
      log.debug("presence published", { topic });
      resolve(true);
    });
  });
}

async function publishOffline({ deviceId, binding }) {
  if (!binding?.companyId || !binding?.userId) return false;
  return publishPresence({
    deviceId,
    companyId: binding.companyId,
    userId: binding.userId,
    userEmail: binding.email || "",
    userName: binding.displayName || "",
    currentApp: "Offline",
    currentCategory: "offline",
    activeWindow: "",
    executable: "",
    cpuNow: 0,
    ramNow: 0,
    state: "offline",
    healthScore: 0,
    sessionId: null,
  });
}

function onCommand(handler) {
  commandHandler = handler;
}

function isConnected() {
  return connected;
}

function disconnect() {
  if (!client) return;
  const next = client;
  client = null;
  connected = false;
  currentIdentity = null;
  next.end(true);
  log.info("disconnected");
}

module.exports = {
  connect,
  publishPresence,
  publishOffline,
  onCommand,
  isConnected,
  disconnect,
};
