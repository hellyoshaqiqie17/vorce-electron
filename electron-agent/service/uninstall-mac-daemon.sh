#!/bin/bash
# Shell Uninstaller Vlinked macOS LaunchDaemon
echo "========================================================"
echo "  Uninstalling Vlinked macOS LaunchDaemon"
echo "========================================================"

if [ "$EUID" -ne 0 ]; then
  echo "Error: Skrip ini harus dijalankan dengan sudo / root privileges."
  echo "Gunakan: sudo bash uninstall-mac-daemon.sh"
  exit 1
fi

PLIST_PATH="/Library/LaunchDaemons/com.vlinked.agent.plist"

if [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null
  rm -f "$PLIST_PATH"
  echo "Status: Vlinked LaunchDaemon berhasil dicopot dari macOS LaunchDaemons!"
else
  echo "Status: LaunchDaemon com.vlinked.agent.plist tidak ditemukan."
fi
