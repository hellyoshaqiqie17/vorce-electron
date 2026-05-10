"use strict";

/**
 * Pure-function semantic analyzer.
 * Classifies apps into categories and computes productivity / focus signals
 * locally. No I/O. No state.
 */

const PRODUCTIVE = /(code|studio|windsurf|cursor|intellij|webstorm|pycharm|rider|electron|terminal|powershell|cmd|git|docker|figma|sketch|notion|obsidian|excel|word|powerpoint|outlook|sheets|docs|slides|jira|linear|trello|monday|asana|salesforce|hubspot|zendesk)/i;
const COMMUNICATION = /(slack|teams|zoom|meet|discord|skype|webex|telegram|whatsapp|signal|gmail|mail|outlook)/i;
const BROWSER = /(chrome|firefox|edge|brave|opera|safari|vivaldi|arc)/i;
const ENTERTAINMENT = /(youtube|netflix|spotify|twitch|tiktok|instagram|facebook|reddit|steam|epic|riot|valorant|league|game)/i;
const SYSTEM = /(explorer|finder|task manager|system|registry|control panel|settings|snipping|search)/i;
const DEV_TITLES = /(\.js|\.ts|\.tsx|\.jsx|\.py|\.go|\.rs|\.java|\.c|\.cpp|\.cs|\.html|\.css|\.json|\.yaml|\.yml|\.md|github|gitlab|bitbucket|stack overflow|stackoverflow|mdn|docs\.)/i;

function classifyApp(appName, windowTitle) {
  const a = String(appName || "").toLowerCase();
  const t = String(windowTitle || "").toLowerCase();
  const blob = `${a} ${t}`;
  if (PRODUCTIVE.test(blob)) return "Productivity";
  if (COMMUNICATION.test(blob)) return "Communication";
  if (BROWSER.test(a)) {
    if (DEV_TITLES.test(t)) return "Productivity";
    if (ENTERTAINMENT.test(t)) return "Entertainment";
    return "Browsing";
  }
  if (ENTERTAINMENT.test(blob)) return "Entertainment";
  if (SYSTEM.test(blob)) return "System";
  return "Application";
}

function productivityScoreFor(category) {
  switch (category) {
    case "Productivity": return 1.0;
    case "Communication": return 0.6;
    case "Browsing": return 0.5;
    case "System": return 0.3;
    case "Entertainment": return 0.1;
    default: return 0.4;
  }
}

function classifyProductivityType(category, durationSeconds, switchCount) {
  if (durationSeconds >= 25 * 60 && switchCount <= 1) return "deep_focus";
  if (durationSeconds >= 10 * 60 && switchCount <= 3) return "focused";
  if (switchCount >= 6) return "fragmented";
  if (category === "Communication") return "collaboration";
  if (category === "Entertainment") return "leisure";
  if (category === "Browsing") return "exploration";
  return "general";
}

/**
 * Compute focus score 0..100 from session metrics.
 * Reward long uninterrupted duration on productive categories.
 */
function computeFocusScore({ durationSeconds, switchCount, category, idleRatio }) {
  const p = productivityScoreFor(category);
  const minutes = durationSeconds / 60;
  const lengthBonus = Math.min(1, minutes / 30); // saturates at 30 min
  const switchPenalty = Math.min(1, switchCount / 8); // 8+ switches kills focus
  const idlePenalty = Math.max(0, Math.min(1, idleRatio || 0));
  const raw = (0.55 * lengthBonus) + (0.25 * p) + (0.20 * (1 - switchPenalty));
  const adjusted = Math.max(0, raw - idlePenalty * 0.25);
  return Math.round(adjusted * 100);
}

/**
 * Derive a high-level behavior tag from rolling stats over a snapshot window.
 * Returns one of:
 *   focused_work | fragmented_focus | high_switching | prolonged_idle |
 *   memory_pressure | multitasking | unstable_workload | balanced
 */
function classifyBehavior(stats) {
  const {
    cpuAvg = 0,
    cpuPeak = 0,
    ramAvg = 0,
    switches = 0,
    idleRatio = 0,
    longestFocusSeconds = 0,
    sessionsCount = 0,
  } = stats || {};

  if (idleRatio > 0.5) return "prolonged_idle";
  if (ramAvg >= 88 || cpuPeak >= 95) return "memory_pressure";
  if (switches >= 30) return "high_switching";
  if (longestFocusSeconds >= 25 * 60 && switches <= 4) return "focused_work";
  if (sessionsCount >= 8 && switches >= 12) return "multitasking";
  if (switches >= 12 && longestFocusSeconds < 10 * 60) return "fragmented_focus";
  if (cpuAvg >= 70 && ramAvg >= 80) return "unstable_workload";
  return "balanced";
}

module.exports = {
  classifyApp,
  classifyProductivityType,
  classifyBehavior,
  computeFocusScore,
  productivityScoreFor,
};
