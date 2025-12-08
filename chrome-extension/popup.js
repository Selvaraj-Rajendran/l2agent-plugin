// L2 Agent - Popup Dashboard

document.addEventListener("DOMContentLoaded", async () => {
  // Elements
  const consentScreen = document.getElementById("consent-screen");
  const dashboard = document.getElementById("dashboard");
  const enableBtn = document.getElementById("enable-btn");
  const toggleTracking = document.getElementById("toggle-tracking");

  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");
  const resultDiv = document.getElementById("result");
  const errorList = document.getElementById("error-list");
  const emptyState = document.getElementById("empty-state");

  const crashCount = document.getElementById("crash-count");
  const apiCount = document.getElementById("api-count");
  const consoleCount = document.getElementById("console-count");
  const screenshotCount = document.getElementById("screenshot-count");

  const captureBtn = document.getElementById("capture-btn");
  const exportBtn = document.getElementById("export-btn");
  const clearBtn = document.getElementById("clear-btn");
  const tabs = document.querySelectorAll(".tab");

  // Screenshot modal elements
  const screenshotModal = document.getElementById("screenshot-modal");
  const modalClose = document.getElementById("modal-close");
  const modalBackdrop = screenshotModal?.querySelector(".modal-backdrop");
  const screenshotImg = document.getElementById("screenshot-img");
  const screenshotReason = document.getElementById("screenshot-reason");
  const screenshotTime = document.getElementById("screenshot-time");
  const downloadScreenshot = document.getElementById("download-screenshot");

  let currentTab = "crashes";
  let data = null;
  let isTracking = false;
  let currentScreenshot = null;

  // =============================================
  // CONSENT CHECK
  // =============================================
  async function checkConsent() {
    try {
      const result = await chrome.storage.local.get([
        "userConsent",
        "trackingEnabled",
      ]);
      
      console.log("L2 Popup: Checking consent", result);

      // Show dashboard if user has given consent (even if tracking is disabled)
      // This allows them to see the UI and re-enable easily
      if (result.userConsent === true) {
        isTracking = result.trackingEnabled !== false;
        console.log("L2 Popup: Showing dashboard, tracking:", isTracking);
        showDashboard();
        await loadErrors();
      } else {
        console.log("L2 Popup: No consent, showing enable screen");
        isTracking = false;
        showConsent();
      }
    } catch (e) {
      console.error("Consent check error:", e);
      isTracking = false;
      showConsent();
    }
  }

  function showConsent() {
    consentScreen.classList.remove("hidden");
    dashboard.classList.add("hidden");
  }

  function showDashboard() {
    consentScreen.classList.add("hidden");
    dashboard.classList.remove("hidden");
    updateToggle();
  }

  function updateToggle() {
    if (isTracking) {
      toggleTracking.classList.add("active");
      toggleTracking.title = "Tracking Active - Click to pause";
    } else {
      toggleTracking.classList.remove("active");
      toggleTracking.title = "Tracking Paused - Click to resume";
    }
  }

  // =============================================
  // ENABLE TRACKING
  // =============================================
  enableBtn.addEventListener("click", async () => {
    // Disable button and show loading state
    enableBtn.disabled = true;
    const originalText = enableBtn.textContent;
    enableBtn.textContent = "⏳ Enabling...";
    
    console.log("L2 Popup: Enable button clicked");

    try {
      // 1. Save consent and enable tracking state
      await chrome.storage.local.set({
        userConsent: true,
        trackingEnabled: true,
      });
      isTracking = true;
      console.log("L2 Popup: State saved, tracking enabled");

      // 2. Notify background script to update its state
      try {
        await chrome.runtime.sendMessage({
          action: "setTrackingEnabled",
          enabled: true,
        });
        console.log("L2 Popup: Background notified");
      } catch (e) {
        console.error("L2 Popup: Failed to notify background", e);
      }

      // 3. Try to notify content script on current tab (if it exists)
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      
      console.log("L2 Popup: Current tab", tab?.url);

      if (tab && isValidUrl(tab.url)) {
        try {
          // Try to send message to content script (it might already be running)
          await chrome.tabs.sendMessage(tab.id, {
            action: "enableTracking",
            enabled: true,
          });
          console.log("L2 Popup: Content script notified");
        } catch (e) {
          // Content script might not be injected yet
          console.log("L2 Popup: Content script not responding:", e.message);
        }
      }

      // 4. Show dashboard
      console.log("L2 Popup: Showing dashboard");
      showDashboard();
      await loadErrors();
      
      // 5. Show success message
      showResult("✓ Tracking enabled! Monitoring for errors.");
      
    } catch (error) {
      console.error("L2 Popup: Enable tracking error:", error);
      showResult("Error enabling tracking: " + error.message, true);

      // Re-enable button on error
      enableBtn.disabled = false;
      enableBtn.textContent = originalText;
    }
  });

  // Toggle tracking - when disabled, show consent screen
  toggleTracking.addEventListener("click", async () => {
    const newState = !isTracking;
    console.log("L2 Popup: Toggle clicked, new state:", newState);

    if (!newState) {
      // User is disabling tracking - keep consent but disable tracking
      // This keeps them in the dashboard with a "disabled" state
      await chrome.storage.local.set({
        userConsent: true,
        trackingEnabled: false,
      });
      isTracking = false;
      
      try {
        await chrome.runtime.sendMessage({
          action: "setTrackingEnabled",
          enabled: false,
        });
      } catch (e) {
        console.error("L2 Popup: Failed to notify background", e);
      }
      
      console.log("L2 Popup: Tracking disabled, staying in dashboard");
      updateToggle();
      showResult("⏸ Tracking paused. Click the toggle to resume.");
    } else {
      // User is re-enabling tracking from toggle - restore tracking
      await chrome.storage.local.set({
        userConsent: true,
        trackingEnabled: true,
      });
      isTracking = true;
      
      try {
        await chrome.runtime.sendMessage({
          action: "setTrackingEnabled",
          enabled: true,
        });
      } catch (e) {
        console.error("L2 Popup: Failed to notify background", e);
      }
      
      updateToggle();
      await loadErrors();
      showResult("▶ Tracking resumed!");
    }
  });

  // =============================================
  // LOAD ERRORS
  // =============================================
  async function loadErrors() {
    try {
      // Get from background
      const bgResponse = await chrome.runtime.sendMessage({
        action: "getStoredErrors",
      });
      if (bgResponse?.success) {
        data = bgResponse.data;
      } else {
        data = {
          crashes: [],
          apiErrors: [],
          consoleErrors: [],
          pageErrors: [],
          screenshots: [],
          stats: {},
        };
      }

      // Also try to get from current page
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab && isValidUrl(tab.url)) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"],
          });
          const pageResponse = await chrome.tabs.sendMessage(tab.id, {
            action: "getErrors",
          });
          if (pageResponse?.success && pageResponse.data) {
            // Merge page data into stored data (avoid duplicates by checking timestamps)
            mergePageData(pageResponse.data);
          }
        } catch (e) {
          console.log("Page data error:", e);
        }
      }

      updateStats();
      updateStatus(tab);
      renderList();
    } catch (e) {
      console.error("Load errors:", e);
      showResult("Error loading data", true);
    }
  }

  function mergePageData(pageData) {
    // Merge console errors
    if (pageData.consoleErrors) {
      pageData.consoleErrors.forEach((err) => {
        if (
          !data.consoleErrors.find(
            (e) => e.timestamp === err.timestamp && e.message === err.message
          )
        ) {
          data.consoleErrors.push(err);
        }
      });
    }
    // Merge page errors
    if (pageData.pageErrors) {
      pageData.pageErrors.forEach((err) => {
        if (!data.pageErrors?.find((e) => e.timestamp === err.timestamp)) {
          if (!data.pageErrors) data.pageErrors = [];
          data.pageErrors.push(err);
        }
      });
    }
    // Merge API errors
    if (pageData.apiErrors) {
      pageData.apiErrors.forEach((err) => {
        if (
          !data.apiErrors.find(
            (e) => e.timestamp === err.timestamp && e.url === err.url
          )
        ) {
          data.apiErrors.push(err);
        }
      });
    }
    // Merge crashes
    if (pageData.crashes) {
      pageData.crashes.forEach((c) => {
        if (!data.crashes.find((e) => e.timestamp === c.timestamp)) {
          data.crashes.push(c);
        }
      });
    }
  }

  function updateStats() {
    if (!data) return;

    const crashes = data.crashes?.length || 0;
    const api = data.apiErrors?.length || 0;
    const console_ =
      (data.consoleErrors?.length || 0) + (data.pageErrors?.length || 0);
    const screenshots = data.screenshots?.length || 0;
    const requests = data.apiRequests?.length || 0;

    crashCount.textContent = crashes;
    apiCount.textContent = api;
    consoleCount.textContent = console_;
    screenshotCount.textContent = screenshots;

    console.log("L2 Stats:", {
      crashes,
      api,
      console: console_,
      screenshots,
      requests,
    });

    // Highlight cards with errors
    document
      .getElementById("crash-card")
      .classList.toggle("has-errors", crashes > 0);
    document.getElementById("api-card").classList.toggle("has-errors", api > 0);
    document
      .getElementById("console-card")
      .classList.toggle("has-errors", console_ > 0);
  }

  function updateStatus(tab) {
    if (tab?.url) {
      try {
        const hostname = new URL(tab.url).hostname;
        statusText.textContent = `Active on: ${hostname}`;
        statusDot.classList.remove("error");

        if (!isValidUrl(tab.url)) {
          statusDot.classList.add("error");
          statusText.textContent = "Cannot track on this page";
        }
      } catch {
        statusText.textContent = "Active";
      }
    }
  }

  // =============================================
  // RENDER ERROR LIST
  // =============================================
  function renderList() {
    if (!data) {
      showEmpty();
      return;
    }

    let items = [];
    switch (currentTab) {
      case "crashes":
        items = data.crashes || [];
        break;
      case "api":
        items = data.apiErrors || [];
        break;
      case "console":
        // Combine console errors and page errors
        items = [...(data.consoleErrors || []), ...(data.pageErrors || [])];
        break;
      case "screenshots":
        items = data.screenshots || [];
        break;
    }

    if (items.length === 0) {
      showEmpty();
      return;
    }

    emptyState.style.display = "none";

    // Sort by timestamp descending and take last 30
    items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    items = items.slice(0, 30);

    if (currentTab === "screenshots") {
      errorList.innerHTML = items
        .map((item, idx) => renderScreenshotItem(item, idx))
        .join("");
      // Add click handlers for screenshots
      document.querySelectorAll(".screenshot-item").forEach((el) => {
        el.addEventListener("click", () => {
          const idx = parseInt(el.dataset.idx);
          openScreenshotModal(items[idx]);
        });
      });
    } else {
      errorList.innerHTML = items
        .map((item) => renderItem(item, currentTab))
        .join("");
    }
  }

  function renderScreenshotItem(item, idx) {
    const time = formatTime(item.timestamp);
    const reasonText = item.reason || "manual";
    const hasImage = item.dataUrl && item.dataUrl !== "[image]";

    return `
      <div class="screenshot-item" data-idx="${idx}">
        ${
          hasImage
            ? `<img class="screenshot-thumb" src="${item.dataUrl}" alt="Screenshot">`
            : `<div class="screenshot-thumb" style="background: var(--bg-tertiary); display: flex; align-items: center; justify-content: center;">📷</div>`
        }
        <div class="screenshot-details">
          <div class="screenshot-reason-text">${escapeHtml(reasonText)}</div>
          <div class="screenshot-time-text">${time}</div>
        </div>
      </div>
    `;
  }

  function openScreenshotModal(screenshot) {
    if (!screenshot) return;
    currentScreenshot = screenshot;

    if (screenshot.dataUrl && screenshot.dataUrl !== "[image]") {
      screenshotImg.src = screenshot.dataUrl;
      screenshotImg.style.display = "block";
    } else {
      screenshotImg.style.display = "none";
    }

    screenshotReason.textContent = screenshot.reason || "manual";
    screenshotTime.textContent = new Date(
      screenshot.timestamp
    ).toLocaleString();
    screenshotModal.classList.remove("hidden");
  }

  function closeScreenshotModal() {
    screenshotModal.classList.add("hidden");
    currentScreenshot = null;
  }

  function renderItem(item, tab) {
    const time = formatTime(item.timestamp);
    let icon = "⚠️";
    let title = "";
    let detail = "";

    switch (tab) {
      case "crashes":
        icon = "💥";
        title = item.reason || "Page Crash Detected";
        detail = item.pageUrl || item.tabUrl || item.url || "";
        break;

      case "api":
        icon = item.status >= 500 ? "🔴" : "🟠";
        title = `${item.method || "GET"} ${item.status || 0} - ${truncate(
          item.url,
          40
        )}`;
        detail = item.traceId
          ? `Trace: ${truncate(item.traceId, 20)} | ${item.duration || 0}ms`
          : item.error || item.statusText || `${item.duration}ms`;
        break;

      case "console":
        icon =
          item.type === "console.error" || item.type === "uncaught_error"
            ? "🔴"
            : "🟡";

        // Better message extraction
        const msg = item.message || "";
        const firstLine = msg.split("\n")[0] || "";

        // Show meaningful title
        if (item.errorType && item.errorType !== "console.error") {
          title = `${item.errorType}: ${truncate(
            firstLine.replace(item.errorType + ": ", ""),
            50
          )}`;
        } else if (
          firstLine.includes("Error:") ||
          firstLine.includes("error")
        ) {
          title = truncate(firstLine, 60);
        } else {
          title = truncate(firstLine || item.type || "Error", 60);
        }

        // Show file/line or second line of message
        if (item.filename) {
          detail = `${item.filename}:${item.lineno || 0}`;
        } else {
          const secondLine = msg.split("\n")[1] || "";
          detail = truncate(secondLine, 60);
        }
        break;

      case "requests":
        // All API requests with status colors
        if (item.status >= 500) icon = "🔴";
        else if (item.status >= 400) icon = "🟠";
        else if (item.status >= 200 && item.status < 300) icon = "🟢";
        else icon = "⚪";

        title = `${item.method || "GET"} ${item.status || 0} - ${truncate(
          item.url,
          35
        )}`;
        detail = `${item.duration || 0}ms - ${item.type || "request"}`;
        break;
    }

    return `
      <div class="error-item ${tab}" title="${escapeHtml(
      item.message || item.reason || ""
    )}">
        <span class="error-icon">${icon}</span>
        <div class="error-content">
          <div class="error-title">${escapeHtml(title)}</div>
          <div class="error-detail">${escapeHtml(detail)}</div>
          <div class="error-time">${time}</div>
        </div>
      </div>
    `;
  }

  function showEmpty() {
    emptyState.style.display = "flex";
    errorList.innerHTML = "";
    errorList.appendChild(emptyState);
  }

  // =============================================
  // TAB SWITCHING
  // =============================================
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      currentTab = tab.dataset.tab;
      renderList();
    });
  });

  // =============================================
  // SCREENSHOT MODAL HANDLERS
  // =============================================
  if (modalClose) {
    modalClose.addEventListener("click", closeScreenshotModal);
  }
  if (modalBackdrop) {
    modalBackdrop.addEventListener("click", closeScreenshotModal);
  }
  if (downloadScreenshot) {
    downloadScreenshot.addEventListener("click", () => {
      if (
        currentScreenshot?.dataUrl &&
        currentScreenshot.dataUrl !== "[image]"
      ) {
        const a = document.createElement("a");
        a.href = currentScreenshot.dataUrl;
        a.download = `screenshot-${
          currentScreenshot.reason || "capture"
        }-${Date.now()}.png`;
        a.click();
        showResult("Screenshot downloaded!");
      } else {
        showResult("No image data available", true);
      }
    });
  }

  // =============================================
  // BUTTONS
  // =============================================
  captureBtn.addEventListener("click", async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "captureScreenshot",
        reason: "manual",
      });
      if (response?.success) {
        showResult("Screenshot captured!");
        await loadErrors();
      } else {
        showResult(
          "Screenshot failed: " + (response?.error || "Unknown"),
          true
        );
      }
    } catch (e) {
      showResult("Screenshot failed: " + e.message, true);
    }
  });

  exportBtn.addEventListener("click", async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        action: "exportErrors",
      });
      if (response?.success) {
        const blob = new Blob([JSON.stringify(response.data, null, 2)], {
          type: "application/json",
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `l2agent-report-${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        showResult("Report exported!");
      }
    } catch (e) {
      showResult("Export failed: " + e.message, true);
    }
  });

  clearBtn.addEventListener("click", async () => {
    if (!confirm("Clear all stored errors and screenshots?")) return;

    try {
      // Clear background storage
      await chrome.runtime.sendMessage({ action: "clearAllErrors" });

      // Clear current page storage
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      if (tab && isValidUrl(tab.url)) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: "clearErrors" });
        } catch {}
      }

      // Reset local data
      data = {
        crashes: [],
        apiErrors: [],
        consoleErrors: [],
        pageErrors: [],
        screenshots: [],
        stats: {},
      };
      updateStats();
      renderList();
      showResult("All errors cleared!");
    } catch (e) {
      showResult("Clear failed: " + e.message, true);
    }
  });

  // =============================================
  // UTILITIES
  // =============================================
  function isValidUrl(url) {
    return url && (url.startsWith("http://") || url.startsWith("https://"));
  }

  function formatTime(timestamp) {
    try {
      return new Date(timestamp).toLocaleTimeString();
    } catch {
      return "";
    }
  }

  function truncate(str, len) {
    if (!str) return "";
    return str.length > len ? str.slice(0, len) + "..." : str;
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showResult(msg, isError = false) {
    resultDiv.textContent = msg;
    resultDiv.className = "result show" + (isError ? " error" : "");
    setTimeout(() => resultDiv.classList.remove("show"), 3000);
  }

  // =============================================
  // INIT
  // =============================================
  await checkConsent();
});
