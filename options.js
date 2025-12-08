// L2 Agent - Options Page Script
document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements
  const form = document.getElementById("options-form");
  const saveMessage = document.getElementById("save-message");
  const clearDataBtn = document.getElementById("clear-data-btn");

  // Settings elements
  const trackingEnabled = document.getElementById("tracking-enabled");
  const freshworksOnly = document.getElementById("freshworks-only");
  const autoScreenshot = document.getElementById("auto-screenshot");
  const trackApi = document.getElementById("track-api");
  const trackConsole = document.getElementById("track-console");
  const crashNotification = document.getElementById("crash-notification");
  const maxErrors = document.getElementById("max-errors");

  // Load saved settings
  chrome.storage.local.get(["settings"], (result) => {
    if (result.settings) {
      const s = result.settings;
      trackingEnabled.checked = s.trackingEnabled !== false;
      freshworksOnly.checked = s.freshworksOnly === true;
      autoScreenshot.checked = s.autoScreenshot !== false;
      trackApi.checked = s.trackApi !== false;
      trackConsole.checked = s.trackConsole !== false;
      crashNotification.checked = s.crashNotification !== false;
      if (s.maxErrors) maxErrors.value = s.maxErrors.toString();
    }
  });

  // Save settings
  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const settings = {
      enabled: true,
      version: "1.0.0",
      trackingEnabled: trackingEnabled.checked,
      freshworksOnly: freshworksOnly.checked,
      autoScreenshot: autoScreenshot.checked,
      trackApi: trackApi.checked,
      trackConsole: trackConsole.checked,
      crashNotification: crashNotification.checked,
      maxErrors: parseInt(maxErrors.value, 10),
      lastUpdated: new Date().toISOString(),
    };

    chrome.storage.local.set({ settings }, () => {
      saveMessage.classList.add("show");
      setTimeout(() => {
        saveMessage.classList.remove("show");
      }, 2500);
    });
  });

  // Clear all data
  clearDataBtn.addEventListener("click", async () => {
    if (confirm("Are you sure you want to clear all stored error data? This cannot be undone.")) {
      try {
        await chrome.runtime.sendMessage({ action: "clearAllErrors" });
        alert("All stored data has been cleared.");
      } catch (error) {
        alert("Failed to clear data: " + error.message);
      }
    }
  });
});
