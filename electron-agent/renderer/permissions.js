"use strict";

document.addEventListener("DOMContentLoaded", () => {
  const badgeAccessibility = document.getElementById("badge-accessibility");
  const badgeAutomation = document.getElementById("badge-automation");
  const btnRequestAccessibility = document.getElementById("btn-request-accessibility");
  const btnRequestAutomation = document.getElementById("btn-request-automation");
  const btnCheckStart = document.getElementById("btn-check-start");

  let isChecking = false;

  async function checkPermissions() {
    if (isChecking) return;
    isChecking = true;

    try {
      const status = await window.vlinkedAgent.invoke("permissions:check");
      
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

      // Note: If both are active, the main process will automatically call
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
