// L2 Agent - Popup Dashboard

console.log("========================================");
console.log("🚀 L2 Agent Popup Script Loading...");
console.log("========================================");

document.addEventListener("DOMContentLoaded", async () => {
  console.log("✅ DOMContentLoaded fired");

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
  const analyzeAllBtn = document.getElementById("analyze-all-btn");
  const tabs = document.querySelectorAll(".tab");

  // Screenshot modal elements
  const screenshotModal = document.getElementById("screenshot-modal");
  const modalClose = document.getElementById("modal-close");
  const modalBackdrop = screenshotModal?.querySelector(".modal-backdrop");
  const screenshotImg = document.getElementById("screenshot-img");
  const screenshotReason = document.getElementById("screenshot-reason");
  const screenshotTime = document.getElementById("screenshot-time");
  const downloadScreenshot = document.getElementById("download-screenshot");

  // API modal elements
  const apiModal = document.getElementById("api-modal");
  const apiModalClose = document.getElementById("api-modal-close");
  const apiModalBackdrop = apiModal?.querySelector(".modal-backdrop");
  const copyApiDetails = document.getElementById("copy-api-details");
  const sendToLlm = document.getElementById("send-to-llm");

  // LLM results modal elements
  const llmResultsModal = document.getElementById("llm-results-modal");
  const llmModalClose = document.getElementById("llm-modal-close");
  const llmModalBackdrop = llmResultsModal?.querySelector(".modal-backdrop");
  const copyLlmResults = document.getElementById("copy-llm-results");
  const downloadLlmResults = document.getElementById("download-llm-results");

  let currentTab = "crashes";
  let data = null;
  let isTracking = false;
  let currentScreenshot = null;
  let currentApiError = null;
  let currentLlmResult = null;

  // =============================================
  // CONSENT CHECK
  // =============================================
  async function checkConsent() {
    try {
      const result = await chrome.storage.local.get([
        "userConsent",
        "trackingEnabled",
      ]);

      // Show dashboard if user has given consent (even if tracking is disabled)
      // This allows them to see the UI and re-enable easily
      if (result.userConsent === true) {
        isTracking = result.trackingEnabled !== false;
        showDashboard();
        await loadErrors();
      } else {
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

    try {
      // 1. Save consent and enable tracking state
      await chrome.storage.local.set({
        userConsent: true,
        trackingEnabled: true,
      });
      isTracking = true;

      // 2. Notify background script to update its state
      try {
        await chrome.runtime.sendMessage({
          action: "setTrackingEnabled",
          enabled: true,
        });
      } catch (e) {
        // Silently fail
      }

      // 3. Try to notify content script on current tab (if it exists)
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });

      if (tab && isValidUrl(tab.url)) {
        try {
          // Try to send message to content script (it might already be running)
          await chrome.tabs.sendMessage(tab.id, {
            action: "enableTracking",
            enabled: true,
          });
        } catch (e) {
          // Content script might not be injected yet
        }
      }

      // 4. Show dashboard
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
        // Silently fail
      }

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
          // Silently fail
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
    } else if (currentTab === "api") {
      errorList.innerHTML = items
        .map((item, idx) => renderItemWithIndex(item, currentTab, idx))
        .join("");
      // Add click handlers for API errors
      document.querySelectorAll(".error-item.api").forEach((el) => {
        el.addEventListener("click", () => {
          const idx = parseInt(el.dataset.idx);
          openApiModal(items[idx]);
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

  function openApiModal(apiError) {
    if (!apiError) return;
    currentApiError = apiError;

    // Set basic info
    document.getElementById("api-method").textContent =
      apiError.method || "GET";
    document.getElementById("api-url").textContent = apiError.url || "";
    document.getElementById("api-status").textContent = `${
      apiError.status || 0
    } ${apiError.statusText || ""}`;
    document.getElementById("api-duration").textContent = `${
      apiError.duration || 0
    }ms`;
    document.getElementById("api-trace-id").textContent =
      apiError.traceId || "N/A";

    // Format and display request headers
    const reqHeaders = apiError.requestHeaders || {};
    document.getElementById("api-request-headers").textContent =
      Object.keys(reqHeaders).length > 0
        ? JSON.stringify(reqHeaders, null, 2)
        : "No request headers captured";

    // Format and display request body
    const reqBody = apiError.requestBody || "";
    if (reqBody) {
      try {
        const parsed = JSON.parse(reqBody);
        document.getElementById("api-request-body").textContent =
          JSON.stringify(parsed, null, 2);
      } catch {
        document.getElementById("api-request-body").textContent = reqBody;
      }
    } else {
      document.getElementById("api-request-body").textContent =
        "No request body";
    }

    // Format and display response headers
    const resHeaders = apiError.responseHeaders || {};
    document.getElementById("api-response-headers").textContent =
      Object.keys(resHeaders).length > 0
        ? JSON.stringify(resHeaders, null, 2)
        : "No response headers captured";

    // Format and display response body
    const resBody = apiError.responseBody || "";
    if (resBody) {
      try {
        const parsed = JSON.parse(resBody);
        document.getElementById("api-response-body").textContent =
          JSON.stringify(parsed, null, 2);
      } catch {
        document.getElementById("api-response-body").textContent = resBody;
      }
    } else {
      document.getElementById("api-response-body").textContent =
        "No response body";
    }

    apiModal.classList.remove("hidden");
  }

  function closeApiModal() {
    apiModal.classList.add("hidden");
    currentApiError = null;
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

  function renderItemWithIndex(item, tab, idx) {
    const time = formatTime(item.timestamp);
    let icon = "⚠️";
    let title = "";
    let detail = "";

    if (tab === "api") {
      icon = item.status >= 500 ? "🔴" : "🟠";
      title = `${item.method || "GET"} ${item.status || 0} - ${truncate(
        item.url,
        40
      )}`;
      detail = item.traceId
        ? `Trace: ${truncate(item.traceId, 20)} | ${item.duration || 0}ms`
        : item.error || item.statusText || `${item.duration}ms`;
    }

    return `
      <div class="error-item ${tab}" data-idx="${idx}" style="cursor: pointer;" title="Click to view details">
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
  // API MODAL HANDLERS
  // =============================================
  if (apiModalClose) {
    apiModalClose.addEventListener("click", closeApiModal);
  }
  if (apiModalBackdrop) {
    apiModalBackdrop.addEventListener("click", closeApiModal);
  }
  if (copyApiDetails) {
    copyApiDetails.addEventListener("click", () => {
      if (!currentApiError) return;

      const details = {
        method: currentApiError.method,
        url: currentApiError.url,
        status: currentApiError.status,
        statusText: currentApiError.statusText,
        duration: currentApiError.duration,
        traceId: currentApiError.traceId,
        requestHeaders: currentApiError.requestHeaders,
        requestBody: currentApiError.requestBody,
        responseHeaders: currentApiError.responseHeaders,
        responseBody: currentApiError.responseBody,
        timestamp: currentApiError.timestamp,
      };

      navigator.clipboard
        .writeText(JSON.stringify(details, null, 2))
        .then(() => showResult("API details copied to clipboard!"))
        .catch(() => showResult("Failed to copy details", true));
    });
  }
  if (sendToLlm) {
    console.log("✅ send-to-llm button found, attaching event listener");
    sendToLlm.addEventListener("click", async (event) => {
      console.log("===========================================");
      console.log("🤖 BUTTON CLICKED - Analyze with LLM");
      console.log("Event:", event);
      console.log("===========================================");

      if (!currentApiError) {
        console.error("❌ No current API error to analyze");
        showResult("No error selected", true);
        return;
      }

      console.log("✅ Current API error:", currentApiError);
      console.log("✅ About to call sendErrorsToLLM function");
      console.log("✅ Function exists?", typeof sendErrorsToLLM);

      // Close modal and show processing
      closeApiModal();
      showResult("🤖 Sending to LLM for analysis...");

      try {
        console.log("✅ Calling sendErrorsToLLM now...");
        await sendErrorsToLLM([currentApiError]);
        console.log("✅ sendErrorsToLLM completed successfully");
      } catch (e) {
        console.error("❌ LLM request failed:", e);
        console.error("❌ Error stack:", e.stack);
        showResult("Failed to send to LLM: " + e.message, true);
      }
    });
  } else {
    console.error("❌ send-to-llm button NOT found in DOM");
  }

  // =============================================
  // LLM RESULTS MODAL HANDLERS
  // =============================================
  if (llmModalClose) {
    llmModalClose.addEventListener("click", closeLlmResultsModal);
  }
  if (llmModalBackdrop) {
    llmModalBackdrop.addEventListener("click", closeLlmResultsModal);
  }
  if (copyLlmResults) {
    copyLlmResults.addEventListener("click", () => {
      if (!currentLlmResult) return;

      const analysis =
        currentLlmResult.result?.analysis ||
        currentLlmResult.analysis ||
        currentLlmResult;
      const textToCopy = formatLlmResultForCopy(analysis);

      navigator.clipboard
        .writeText(textToCopy)
        .then(() => showResult("Analysis copied to clipboard!"))
        .catch(() => showResult("Failed to copy analysis", true));
    });
  }
  if (downloadLlmResults) {
    downloadLlmResults.addEventListener("click", () => {
      if (!currentLlmResult) return;

      const analysis =
        currentLlmResult.result?.analysis ||
        currentLlmResult.analysis ||
        currentLlmResult;
      const textToDownload = formatLlmResultForCopy(analysis);

      const blob = new Blob([textToDownload], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `llm-analysis-${Date.now()}.txt`;
      a.click();
      URL.revokeObjectURL(url);
      showResult("Analysis downloaded!");
    });
  }

  function formatLlmResultForCopy(analysis) {
    let text = "🤖 LLM ERROR ANALYSIS\n";
    text += "=" + "=".repeat(50) + "\n\n";

    // Tags
    if (analysis.tags) {
      text += "🏷️ CLASSIFICATION\n";
      text += "-".repeat(50) + "\n";
      if (analysis.tags.errorType)
        text += `Error Type: ${analysis.tags.errorType}\n`;
      if (analysis.tags.severity)
        text += `Severity: ${analysis.tags.severity}\n`;
      if (analysis.tags.category)
        text += `Category: ${analysis.tags.category}\n`;
      text += "\n";
    }

    // Root Cause
    if (analysis.rootCause) {
      text += "🔍 ROOT CAUSE\n";
      text += "-".repeat(50) + "\n";
      text += `Summary: ${analysis.rootCause.summary}\n\n`;
      text += `Details:\n${analysis.rootCause.details}\n\n`;
    }

    // Affected Components
    if (analysis.affectedComponents && analysis.affectedComponents.length > 0) {
      text += "⚙️ AFFECTED COMPONENTS\n";
      text += "-".repeat(50) + "\n";
      analysis.affectedComponents.forEach((comp, idx) => {
        text += `${idx + 1}. ${comp}\n`;
      });
      text += "\n";
    }

    // Recommendations
    if (analysis.recommendations && analysis.recommendations.length > 0) {
      text += "💡 RECOMMENDATIONS\n";
      text += "-".repeat(50) + "\n";
      analysis.recommendations.forEach((rec, idx) => {
        text += `${idx + 1}. ${rec}\n`;
      });
      text += "\n";
    }

    // Additional Context
    if (analysis.additionalContext) {
      text += "📝 ADDITIONAL CONTEXT\n";
      text += "-".repeat(50) + "\n";
      text += `${analysis.additionalContext}\n\n`;
    }

    text += "=" + "=".repeat(50) + "\n";
    text += `Generated: ${new Date().toLocaleString()}\n`;

    return text;
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

  analyzeAllBtn.addEventListener("click", async () => {
    console.log("🤖 Analyze All Errors button clicked");
    console.log("Current data:", data);

    if (
      !data ||
      (!data.apiErrors?.length &&
        !data.consoleErrors?.length &&
        !data.crashes?.length)
    ) {
      console.error("No errors available to analyze");
      showResult("No errors to analyze", true);
      return;
    }

    showResult("🤖 Preparing data for LLM analysis...");

    try {
      await sendErrorsToLLM();
    } catch (e) {
      console.error("Analyze all failed:", e);
      showResult("Failed to send to LLM: " + e.message, true);
    }
  });

  // =============================================
  // LLM INTEGRATION
  // =============================================
  async function sendErrorsToLLM(specificErrors = null) {
    try {
      console.log("=== Starting LLM Request ===");
      console.log("Specific errors:", specificErrors);

      // Get backend URL from options or use default
      const settings = await chrome.storage.sync.get("backendUrl");
      const backendUrl = settings.backendUrl || "http://localhost:3000";
      console.log("Backend URL:", backendUrl);

      // Format the data for LLM
      const formattedData = formatDataForLLM(specificErrors);
      console.log("Formatted data length:", formattedData.length);
      console.log("Formatted data preview:", formattedData.substring(0, 500));

      showResult("📡 Sending to LLM...");

      const requestBody = {
        data: formattedData,
        context: {
          timestamp: new Date().toISOString(),
          source: "l2-agent-extension",
          errorCount: {
            crashes: data?.crashes?.length || 0,
            apiErrors: data?.apiErrors?.length || 0,
            consoleErrors: data?.consoleErrors?.length || 0,
          },
        },
        action: "analyze",
      };

      console.log("Request body:", JSON.stringify(requestBody, null, 2));
      console.log("Making fetch request to:", `${backendUrl}/api/process`);

      // Send to backend
      const response = await fetch(`${backendUrl}/api/process`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      console.log("Response received:", response);
      console.log("Response status:", response.status);
      console.log("Response ok:", response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Backend error response:", errorText);
        throw new Error(
          `Backend returned ${response.status}: ${response.statusText}`
        );
      }

      const result = await response.json();
      console.log("LLM result received:", result);

      // Show result modal with LLM analysis
      showLLMResult(result);
      showResult("✅ Analysis complete!");
    } catch (error) {
      console.error("=== LLM Request Failed ===");
      console.error("Error type:", error.name);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
      console.error("Full error:", error);
      throw error;
    }
  }

  function formatDataForLLM(specificErrors = null) {
    if (specificErrors) {
      // Format specific errors (e.g., single API error from modal)
      return JSON.stringify(
        {
          type: "specific_error_analysis",
          errors: specificErrors.map((err) => ({
            type: err.type || "api_error",
            method: err.method,
            url: err.url,
            status: err.status,
            statusText: err.statusText,
            duration: err.duration,
            traceId: err.traceId,
            requestHeaders: err.requestHeaders,
            requestBody: err.requestBody,
            responseHeaders: err.responseHeaders,
            responseBody: err.responseBody,
            errorDetails: err.errorDetails,
            timestamp: err.timestamp,
          })),
        },
        null,
        2
      );
    }

    // Format all collected data
    const formattedData = {
      type: "comprehensive_error_analysis",
      summary: {
        totalCrashes: data?.crashes?.length || 0,
        totalApiErrors: data?.apiErrors?.length || 0,
        totalConsoleErrors: data?.consoleErrors?.length || 0,
        timeRange: {
          from: getOldestTimestamp(),
          to: new Date().toISOString(),
        },
      },
      crashes: (data?.crashes || []).map((crash) => ({
        reason: crash.reason,
        url: crash.url || crash.pageUrl,
        timestamp: crash.timestamp,
        recentApiErrors: crash.recentApiErrors || [],
        recentConsoleErrors: crash.recentConsoleErrors || [],
        detectionMethod: crash.detectionMethod,
      })),
      apiErrors: (data?.apiErrors || []).slice(0, 10).map((err) => ({
        method: err.method,
        url: err.url,
        status: err.status,
        statusText: err.statusText,
        duration: err.duration,
        traceId: err.traceId,
        requestHeaders: err.requestHeaders,
        requestBody: err.requestBody,
        responseHeaders: err.responseHeaders,
        responseBody: err.responseBody,
        errorDetails: err.errorDetails,
        timestamp: err.timestamp,
      })),
      consoleErrors: (data?.consoleErrors || []).slice(0, 10).map((err) => ({
        type: err.type,
        message: err.message,
        errorType: err.errorType,
        stack: err.stack,
        filename: err.filename,
        lineno: err.lineno,
        timestamp: err.timestamp,
      })),
    };

    return JSON.stringify(formattedData, null, 2);
  }

  function getOldestTimestamp() {
    const allTimestamps = [
      ...(data?.crashes || []).map((e) => e.timestamp),
      ...(data?.apiErrors || []).map((e) => e.timestamp),
      ...(data?.consoleErrors || []).map((e) => e.timestamp),
    ].filter(Boolean);

    if (allTimestamps.length === 0) return new Date().toISOString();

    return allTimestamps.sort()[0];
  }

  function showLLMResult(result) {
    currentLlmResult = result;
    const analysis = result.result?.analysis || result.analysis || result;

    // Check if we got a structured analysis or raw text
    if (analysis.tags && analysis.rootCause) {
      // Structured response
      displayStructuredAnalysis(analysis);
    } else if (typeof analysis === "string" || analysis.rawResponse) {
      // Raw text response - try to display nicely
      displayRawAnalysis(analysis.rawResponse || analysis);
    } else {
      // Unknown format
      displayRawAnalysis(JSON.stringify(analysis, null, 2));
    }

    // Show the modal
    llmResultsModal.classList.remove("hidden");
  }

  function displayStructuredAnalysis(analysis) {
    // Display tags
    const tagsContainer = document.getElementById("llm-tags");
    tagsContainer.innerHTML = "";

    if (analysis.tags) {
      if (analysis.tags.errorType) {
        const typeTag = document.createElement("div");
        typeTag.className = `llm-tag error-type-${analysis.tags.errorType.toLowerCase()}`;
        typeTag.textContent = `${analysis.tags.errorType} Issue`;
        tagsContainer.appendChild(typeTag);
      }

      if (analysis.tags.severity) {
        const severityTag = document.createElement("div");
        severityTag.className = `llm-tag severity-${analysis.tags.severity.toLowerCase()}`;
        severityTag.textContent = `${analysis.tags.severity} Severity`;
        tagsContainer.appendChild(severityTag);
      }

      if (analysis.tags.category) {
        const categoryTag = document.createElement("div");
        categoryTag.className = "llm-tag category";
        categoryTag.textContent = analysis.tags.category;
        tagsContainer.appendChild(categoryTag);
      }
    }

    // Display root cause
    if (analysis.rootCause) {
      document.getElementById("llm-summary").innerHTML = `
        <strong>Summary</strong>
        <p>${escapeHtml(analysis.rootCause.summary || "N/A")}</p>
      `;

      document.getElementById("llm-details").textContent =
        analysis.rootCause.details || "No detailed explanation provided.";

      document.getElementById("llm-root-cause-section").style.display = "block";
    } else {
      document.getElementById("llm-root-cause-section").style.display = "none";
    }

    // Display affected components
    if (analysis.affectedComponents && analysis.affectedComponents.length > 0) {
      const componentsContainer = document.getElementById("llm-components");
      componentsContainer.innerHTML = "";

      analysis.affectedComponents.forEach((component) => {
        const compDiv = document.createElement("div");
        compDiv.className = "llm-component";
        compDiv.textContent = component;
        componentsContainer.appendChild(compDiv);
      });

      document.getElementById("llm-components-section").style.display = "block";
    } else {
      document.getElementById("llm-components-section").style.display = "none";
    }

    // Display recommendations
    if (analysis.recommendations && analysis.recommendations.length > 0) {
      const recommendationsContainer = document.getElementById(
        "llm-recommendations"
      );
      recommendationsContainer.innerHTML = "";

      analysis.recommendations.forEach((rec) => {
        const recDiv = document.createElement("div");
        recDiv.className = "llm-recommendation";
        recDiv.textContent = rec;
        recommendationsContainer.appendChild(recDiv);
      });

      document.getElementById("llm-recommendations-section").style.display =
        "block";
    } else {
      document.getElementById("llm-recommendations-section").style.display =
        "none";
    }

    // Display additional context
    if (analysis.additionalContext) {
      document.getElementById("llm-context").textContent =
        analysis.additionalContext;
      document.getElementById("llm-context-section").style.display = "block";
    } else {
      document.getElementById("llm-context-section").style.display = "none";
    }

    // Display raw response
    const rawResponse =
      currentLlmResult.result?.rawResponse ||
      currentLlmResult.rawResponse ||
      JSON.stringify(analysis, null, 2);
    document.getElementById("llm-raw-response").textContent = rawResponse;
  }

  function displayRawAnalysis(rawText) {
    // Hide all structured sections
    document.getElementById("llm-tags-section").style.display = "none";
    document.getElementById("llm-root-cause-section").style.display = "none";
    document.getElementById("llm-components-section").style.display = "none";
    document.getElementById("llm-recommendations-section").style.display =
      "none";

    // Show raw text in context section
    document.getElementById("llm-context").innerHTML = `
      <div class="llm-error-message">
        <strong>⚠️ Unstructured Response</strong><br><br>
        The LLM did not return a structured analysis. Here is the raw response:
      </div>
      <pre style="margin-top: 12px; white-space: pre-wrap; word-wrap: break-word;">${escapeHtml(
        rawText
      )}</pre>
    `;
    document.getElementById("llm-context-section").style.display = "block";

    // Display raw response
    document.getElementById("llm-raw-response").textContent = rawText;
  }

  function closeLlmResultsModal() {
    llmResultsModal.classList.add("hidden");
    currentLlmResult = null;
  }

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
