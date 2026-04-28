"use strict";

/**
 * Foreground window detection via active-win.
 *
 * active-win v8+ is ESM-only so we lazy-import it from this CJS module.
 * Only process name and window title are surfaced — no URLs, no file paths.
 */

let activeWinPromise = null;

function loadActiveWin() {
  if (!activeWinPromise) {
    activeWinPromise = import("active-win").then((m) => m.default || m);
  }
  return activeWinPromise;
}

async function getActiveApp() {
  try {
    const activeWin = await loadActiveWin();
    const result = await activeWin();
    if (!result) return { name: "", title: "" };

    const processName =
      (result.owner && (result.owner.name || result.owner.processName)) || "";
    const title = result.title || "";

    return { name: processName, title };
  } catch (_err) {
    return { name: "", title: "" };
  }
}

module.exports = { getActiveApp };
