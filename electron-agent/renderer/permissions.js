"use strict";

document.addEventListener("DOMContentLoaded", () => {
  // Add macOS detection for layout fixes
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0 || navigator.userAgent.includes('Macintosh');
  if (isMac) {
    document.body.classList.add("platform-darwin");
  }

  const badgeAccessibility = document.getElementById("badge-accessibility");
  const badgeAutomation = document.getElementById("badge-automation");
  const badgeScreenRecording = document.getElementById("badge-screen-recording");
  const badgeLocation = document.getElementById("badge-location");
  const btnRequestAccessibility = document.getElementById("btn-request-accessibility");
  const btnRequestAutomation = document.getElementById("btn-request-automation");
  const btnRequestScreenRecording = document.getElementById("btn-request-screen-recording");
  const btnRequestLocation = document.getElementById("btn-request-location");
  const btnCheckStart = document.getElementById("btn-check-start");

  let isChecking = false;

  async function checkLocationPermission() {
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const result = await navigator.permissions.query({ name: 'geolocation' });
        if (result.state === "granted") return true;
        if (result.state === "denied") return false;
        if (result.state === "prompt") return false;
      } catch (_) {
        // ignore and fallback
      }
    }
    
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve(true);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        () => resolve(true),
        (err) => {
          if (err.code === 1) { // PERMISSION_DENIED
            resolve(false);
          } else {
            resolve(true); // Unavailable / Timeout means permission is granted
          }
        },
        { enableHighAccuracy: false, timeout: 1000, maximumAge: 10000 }
      );
    });
  }

  async function checkPermissions() {
    if (isChecking) return;
    isChecking = true;

    try {
      const hasLocation = isMac ? await checkLocationPermission() : true;
      const status = await window.vlinkedAgent.invoke("permissions:check", hasLocation);
      
      // Update Accessibility Badge
      if (status.accessibility) {
        badgeAccessibility.className = "perm-badge active";
        badgeAccessibility.textContent = "Aktif";
      } else {
        badgeAccessibility.className = "perm-badge inactive";
        badgeAccessibility.textContent = "Belum Aktif";
      }

      // Update Automation Badge
      if (status.automation) {
        badgeAutomation.className = "perm-badge active";
        badgeAutomation.textContent = "Aktif";
      } else {
        badgeAutomation.className = "perm-badge inactive";
        badgeAutomation.textContent = "Belum Aktif";
      }

      // Update Screen Recording Badge
      if (badgeScreenRecording) {
        if (status.screenRecording) {
          badgeScreenRecording.className = "perm-badge active";
          badgeScreenRecording.textContent = "Aktif";
        } else {
          badgeScreenRecording.className = "perm-badge inactive";
          badgeScreenRecording.textContent = "Belum Aktif";
        }
      }

      // Update Location Badge
      if (badgeLocation) {
        if (status.location) {
          badgeLocation.className = "perm-badge active";
          badgeLocation.textContent = "Aktif";
        } else {
          badgeLocation.className = "perm-badge inactive";
          badgeLocation.textContent = "Belum Aktif";
        }
      }

      // Update Progress Bar
      let count = 0;
      if (status.accessibility) count++;
      if (status.automation) count++;
      if (status.screenRecording) count++;
      if (status.location) count++;

      const pct = count === 4 ? 100 : count === 3 ? 75 : count === 2 ? 50 : count === 1 ? 25 : 0;
      const progressText = document.getElementById("progress-text");
      const progressBar = document.getElementById("progress-bar");
      if (progressText && progressBar) {
        progressText.textContent = `${count}/4 Izin Aktif (${pct}%)`;
        progressBar.style.width = `${pct}%`;
        progressBar.style.backgroundColor = "var(--green)";
        progressText.style.color = "var(--green)";
      }

      // Note: If all are active, the main process will automatically call
      // mainWindow.loadFile("renderer/index.html"), which will unload this page.
    } catch (err) {
      console.error("Gagal memeriksa izin akses:", err);
    } finally {
      isChecking = false;
    }
  }

  // Bind request triggers
  btnRequestAccessibility.addEventListener("click", () => {
    window.vlinkedAgent.invoke("permissions:request-accessibility");
  });

  btnRequestAutomation.addEventListener("click", () => {
    window.vlinkedAgent.invoke("permissions:request-automation");
  });

  if (btnRequestScreenRecording) {
    btnRequestScreenRecording.addEventListener("click", () => {
      window.vlinkedAgent.invoke("permissions:request-screen-recording");
    });
  }

  if (btnRequestLocation) {
    btnRequestLocation.addEventListener("click", () => {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            console.log("Location allowed:", position);
            checkPermissions();
          },
          (error) => {
            console.warn("Location prompt failed/denied, opening settings:", error);
            window.vlinkedAgent.invoke("permissions:request-location");
          },
          { enableHighAccuracy: false, timeout: 5000, maximumAge: 0 }
        );
      } else {
        window.vlinkedAgent.invoke("permissions:request-location");
      }
    });
  }

  const btnBypassPermissions = document.getElementById("btn-bypass-permissions");
  btnBypassPermissions.addEventListener("click", () => {
    window.vlinkedAgent.invoke("permissions:bypass");
  });

  // Manual trigger
  btnCheckStart.addEventListener("click", async () => {
    btnCheckStart.disabled = true;
    btnCheckStart.textContent = "Memeriksa...";
    
    await checkPermissions();
    
    // If we are still here, it means some permissions are still missing
    setTimeout(() => {
      btnCheckStart.disabled = false;
      btnCheckStart.textContent = "Periksa Izin & Mulai Aplikasi";
    }, 500);
  });

  // Initial check
  checkPermissions();

  // Dynamic Polling: Check every 2 seconds
  const pollingInterval = setInterval(checkPermissions, 2000);

  // Clean up polling interval when page is unloaded
  window.addEventListener("unload", () => {
    clearInterval(pollingInterval);
  });
});
