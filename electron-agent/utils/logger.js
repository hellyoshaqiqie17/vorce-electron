"use strict";

/**
 * Tiny structured logger. Keeps the agent dependency-free for logging
 * while still giving level-tagged output for diagnostics.
 */

const levels = ["debug", "info", "warn", "error"];
const minLevel = process.env.VORCE_AGENT_LOG_LEVEL || "info";
const minIdx = Math.max(0, levels.indexOf(minLevel));

const logHistory = [];
const maxLogs = 1000;

function addLog(level, scope, message, meta) {
  const entry = {
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    module: scope,
    message: meta && Object.keys(meta).length > 0 ? `${message} ${JSON.stringify(meta)}` : message
  };
  logHistory.push(entry);
  if (logHistory.length > maxLogs) {
    logHistory.shift();
  }
}

function getLogs() {
  return [...logHistory];
}

function format(level, scope, message, meta) {
  const ts = new Date().toISOString();
  const tag = `[${ts}] [${level.toUpperCase()}] [${scope}]`;
  if (meta && Object.keys(meta).length > 0) {
    return `${tag} ${message} ${JSON.stringify(meta)}`;
  }
  return `${tag} ${message}`;
}

function make(scope) {
  const out = {};
  levels.forEach((lvl, idx) => {
    out[lvl] = (message, meta) => {
      addLog(lvl, scope, String(message), meta);
      if (idx < minIdx) return;
      const line = format(lvl, scope, String(message), meta);
      if (lvl === "error") {
        console.error(line);
      } else if (lvl === "warn") {
        console.warn(line);
      } else {
        console.log(line);
      }
    };
  });
  return out;
}

module.exports = { make, getLogs };

