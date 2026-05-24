"use strict";

const { exec } = require("child_process");
const os = require("os");
const { make } = require("./logger");

const log = make("deviceControl");

function lockWorkstation() {
  const platform = os.platform();
  log.info("Attempting to lock device workstation...", { platform });

  if (platform === "win32") {
    exec("rundll32.exe user32.dll,LockWorkStation", (err) => {
      if (err) log.error("Failed to lock Windows workstation", { err: err.message });
    });
  } else if (platform === "darwin") {
    // macOS lock screen session (try CGSession, displaysleepnow, and AppleScript lock shortcut)
    exec("/System/Library/CoreServices/Menu\\ Extras/User.menu/Contents/Resources/CGSession -suspend || pmset displaysleepnow || osascript -e 'tell application \"System Events\" to keystroke \"q\" using {control down, command down}'", (err) => {
      if (err) log.error("Failed to lock macOS screen", { err: err.message });
    });
  } else {
    // Linux generic lock screen
    exec("xdg-screensaver lock || gnome-screensaver-command -l", (err) => {
      if (err) log.error("Failed to lock Linux workstation", { err: err.message });
    });
  }
}

function shutdownDevice() {
  const platform = os.platform();
  log.warn("Attempting to shutdown device...", { platform });

  if (platform === "win32") {
    exec("shutdown /s /f /t 0", (err) => {
      if (err) log.error("Failed to shut down Windows device", { err: err.message });
    });
  } else if (platform === "darwin") {
    // macOS user-level shutdown via AppleScript (avoids requiring sudo)
    exec("osascript -e 'tell application \"System Events\" to shut down'", (err) => {
      if (err) {
        log.warn("AppleScript shutdown failed, trying standard shutdown command", { err: err.message });
        exec("shutdown -h now", (err2) => {
          if (err2) log.error("Failed to shut down macOS device", { err: err2.message });
        });
      }
    });
  } else {
    // Linux standard shutdown
    exec("shutdown -h now || poweroff", (err) => {
      if (err) log.error("Failed to shut down Linux device", { err: err.message });
    });
  }
}

module.exports = {
  lockWorkstation,
  shutdownDevice,
};
