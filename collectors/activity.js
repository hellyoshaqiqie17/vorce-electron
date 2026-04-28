"use strict";

/**
 * Foreground window detection via `active-win`.
 *
 * `active-win` v8+ is ESM-only, so we lazy-import it from this CommonJS
 * module. We deliberately surface only `name` (process name) and `title`
 * (window title). Anything more — URLs, document paths, browser-specific
 * fields — would push us into territory the spec explicitly forbids.
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
    // Windowing systems (e.g. Wayland) may refuse the query — return blanks
    // rather than crashing the metrics loop.
    return { name: "", title: "" };
  }
}

module.exports = { getActiveApp };
