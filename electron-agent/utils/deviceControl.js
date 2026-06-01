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
    // macOS lock screen session:
    // 1. pmset displaysleepnow (locks screen if password is set to "immediately" in System Settings)
    // 2. open -a ScreenSaverEngine (starts screen saver, locks if password is "immediately")
    exec("pmset displaysleepnow || open -a ScreenSaverEngine", (err) => {
      if (err) {
        log.warn("Standard macOS lock failed, trying AppleScript keystroke...", { err: err.message });
        
        // Before running AppleScript, check Accessibility permission
        const { systemPreferences, dialog, shell } = require("electron");
        const hasAccess = systemPreferences.isTrustedAccessibilityClient(false);
        
        if (!hasAccess) {
          log.warn("Accessibility permission is missing for locking screen via keystroke.");
          // Prompt user to enable Accessibility
          dialog.showMessageBox({
            type: "warning",
            title: "Izin Aksesibilitas Diperlukan",
            message: "Vlinked memerlukan izin Aksesibilitas untuk mengunci layar Mac Anda.",
            detail: "Silakan aktifkan izin untuk Vlinked di System Settings > Privacy & Security > Accessibility agar penguncian layar dapat berfungsi.",
            buttons: ["Buka System Settings", "Batal"],
            defaultId: 0,
            cancelId: 1,
          }).then(({ response }) => {
            if (response === 0) {
              shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
            }
          });
        } else {
          exec("osascript -e 'tell application \"System Events\" to keystroke \"q\" using {control down, command down}'", (err2) => {
            if (err2) log.error("Failed to lock macOS screen via keystroke", { err: err2.message });
          });
        }
      }
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
    // macOS shutdown:
    // 1. AppleScript tell System Events (requires Automation permission for System Events)
    exec("osascript -e 'tell application \"System Events\" to shut down'", (err) => {
      if (err) {
        log.warn("AppleScript System Events shutdown failed, trying Finder...", { err: err.message });
        
        exec("osascript -e 'tell application \"Finder\" to shut down'", (err2) => {
          if (err2) {
            log.error("AppleScript Finder shutdown also failed", { err: err2.message });
            
            const errMsg = (err.message || "") + " " + (err2.message || "");
            const isPermissionError = errMsg.includes("-1743") || errMsg.includes("authorized") || errMsg.includes("allow");
            
            if (isPermissionError) {
              const { dialog, shell } = require("electron");
              dialog.showMessageBox({
                type: "warning",
                title: "Izin Otomatisasi Diperlukan",
                message: "Vlinked memerlukan izin Otomatisasi (Automation) untuk mematikan komputer.",
                detail: "Silakan aktifkan izin Otomatisasi untuk Vlinked di System Settings > Privacy & Security > Automation agar fitur shutdown dapat digunakan.",
                buttons: ["Buka System Settings", "Batal"],
                defaultId: 0,
                cancelId: 1,
              }).then(({ response }) => {
                if (response === 0) {
                  shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Automation");
                }
              });
            } else {
              // Try standard shutdown (requires root/sudo privileges)
              exec("shutdown -h now", (err3) => {
                if (err3) log.error("Failed to shut down macOS device", { err: err3.message });
              });
            }
          }
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
