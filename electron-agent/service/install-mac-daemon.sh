#!/bin/bash
# Shell Installer Vlinked macOS LaunchDaemon (Pre-Login & Lockscreen Execution)
echo "========================================================"
echo "  Installing Vlinked macOS LaunchDaemon (Root Service)"
echo "========================================================"

if [ "$EUID" -ne 0 ]; then
  echo "Error: Skrip ini harus dijalankan dengan sudo / root privileges."
  echo "Gunakan: sudo bash install-mac-daemon.sh"
  exit 1
fi

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PLIST_PATH="/Library/LaunchDaemons/com.vlinked.agent.plist"

# Copy plist to system LaunchDaemons directory
cp "$SCRIPT_DIR/com.vlinked.agent.plist" "$PLIST_PATH"
chown root:wheel "$PLIST_PATH"
chmod 644 "$PLIST_PATH"

# Unload previous instance if loaded
launchctl unload "$PLIST_PATH" 2>/dev/null

# Load and start LaunchDaemon
launchctl load -w "$PLIST_PATH"

echo ""
echo "Status: Vlinked LaunchDaemon berhasil terinstall dan berjalan di background OS macOS!"
echo "Service akan otomatis berjalan saat macOS booting (posisi macOS Login Window / Lockscreen)."
