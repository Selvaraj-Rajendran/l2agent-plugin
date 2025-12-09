// L2 Agent - Options Page Script
document.addEventListener("DOMContentLoaded", () => {
  // DOM Elements
  const form = document.getElementById("options-form");
  const backendUrlInput = document.getElementById("backend-url");
  const saveMessage = document.getElementById("save-message");
  const clearDataBtn = document.getElementById("clear-data-btn");
  const testConnectionBtn = document.getElementById("test-connection-btn");
  const connectionStatus = document.getElementById("connection-status");

  // Settings elements
  const trackingEnabled = document.getElementById("tracking-enabled");
  const freshworksOnly = document.getElementById("freshworks-only");
  const autoScreenshot = document.getElementById("auto-screenshot");
  const trackApi = document.getElementById("track-api");
  const trackConsole = document.getElementById("track-console");
  const crashNotification = document.getElementById("crash-notification");
  const maxErrors = document.getElementById("max-errors");
  const aiEnabled = document.getElementById("ai-enabled");

  // Load saved settings
  chrome.storage.local.get(["settings"], (result) => {
    if (result.settings) {
      const s = result.settings;
      if (trackingEnabled) trackingEnabled.checked = s.trackingEnabled !== false;
      if (freshworksOnly) freshworksOnly.checked = s.freshworksOnly === true;
      if (autoScreenshot) autoScreenshot.checked = s.autoScreenshot !== false;
      if (trackApi) trackApi.checked = s.trackApi !== false;
      if (trackConsole) trackConsole.checked = s.trackConsole !== false;
      if (crashNotification) crashNotification.checked = s.crashNotification !== false;
      if (maxErrors && s.maxErrors) maxErrors.value = s.maxErrors.toString();
      if (backendUrlInput && s.backendUrl) {
        backendUrlInput.value = s.backendUrl;
      }
      if (aiEnabled) aiEnabled.checked = s.aiEnabled !== false;
    }
  });

  // Save settings
  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const settings = {
      enabled: true,
      version: "1.0.0",
      trackingEnabled: trackingEnabled?.checked ?? true,
      freshworksOnly: freshworksOnly?.checked ?? false,
      autoScreenshot: autoScreenshot?.checked ?? true,
      trackApi: trackApi?.checked ?? true,
      trackConsole: trackConsole?.checked ?? true,
      crashNotification: crashNotification?.checked ?? true,
      maxErrors: parseInt(maxErrors?.value || "500", 10),
      backendUrl: backendUrlInput?.value || "http://localhost:3000",
      aiEnabled: aiEnabled?.checked ?? true,
      lastUpdated: new Date().toISOString(),
    };

    chrome.storage.local.set({ settings }, () => {
      saveMessage.classList.add("show");
      setTimeout(() => {
        saveMessage.classList.remove("show");
      }, 2500);
    });
  });

  // Test connection to backend
  if (testConnectionBtn) {
    testConnectionBtn.addEventListener("click", async () => {
      const url = backendUrlInput?.value || "http://localhost:3000";
      
      testConnectionBtn.disabled = true;
      testConnectionBtn.textContent = "⏳ Testing...";
      connectionStatus.style.display = "block";
      connectionStatus.textContent = "Connecting...";
      connectionStatus.style.background = "rgba(59, 130, 246, 0.15)";
      connectionStatus.style.color = "#3b82f6";
      connectionStatus.style.border = "1px solid rgba(59, 130, 246, 0.3)";

      try {
        const response = await fetch(`${url}/health`, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (response.ok) {
          const data = await response.json();
          connectionStatus.textContent = `✓ Connected! Server status: ${data.status || "ok"}`;
          connectionStatus.style.background = "rgba(34, 197, 94, 0.15)";
          connectionStatus.style.color = "#22c55e";
          connectionStatus.style.border = "1px solid rgba(34, 197, 94, 0.3)";
          
          // Also check LLM status
          if (data.services?.llm?.connected) {
            connectionStatus.textContent += " | LLM: Connected";
          } else if (data.services?.llm?.configured) {
            connectionStatus.textContent += " | LLM: Configured (not tested)";
          }
        } else {
          connectionStatus.textContent = `✗ Server returned ${response.status}`;
          connectionStatus.style.background = "rgba(239, 68, 68, 0.15)";
          connectionStatus.style.color = "#ef4444";
          connectionStatus.style.border = "1px solid rgba(239, 68, 68, 0.3)";
        }
      } catch (error) {
        connectionStatus.textContent = `✗ Connection failed: ${error.message}`;
        connectionStatus.style.background = "rgba(239, 68, 68, 0.15)";
        connectionStatus.style.color = "#ef4444";
        connectionStatus.style.border = "1px solid rgba(239, 68, 68, 0.3)";
      } finally {
        testConnectionBtn.disabled = false;
        testConnectionBtn.textContent = "🔗 Test Connection";
      }
    });
  }

  // Clear all data
  if (clearDataBtn) {
    clearDataBtn.addEventListener("click", async () => {
      if (
        confirm(
          "Are you sure you want to clear all stored error data? This cannot be undone."
        )
      ) {
        try {
          await chrome.runtime.sendMessage({ action: "clearAllErrors" });
          alert("All stored data has been cleared.");
        } catch (error) {
          alert("Failed to clear data: " + error.message);
        }
      }
    });
  }
});
