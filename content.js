// L2 Agent - Content Script (Isolated World)
// This acts as a BRIDGE between the main world script and the background service worker
// The actual error capturing happens in injected.js which runs in the page's context

(function () {
  "use strict";

  if (window.__L2AgentContentInjected) return;
  window.__L2AgentContentInjected = true;

  console.log("🟢 L2 Agent: Content script starting...");

  // Storage for collected data (mirror of what's collected in main world)
  const data = {
    consoleErrors: [],
    pageErrors: [],
    apiErrors: [],
    apiRequests: [],
    crashes: [],
    sessionId: null,
    pageUrl: location.href,
  };

  // =============================================
  // INJECT MAIN WORLD SCRIPT
  // =============================================
  function injectMainWorldScript() {
    try {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("injected.js");
      script.onload = function () {
        console.log("🟢 L2 Agent: Main world script injected successfully");
        this.remove();
      };
      script.onerror = function (e) {
        console.error("🔴 L2 Agent: Failed to inject main world script", e);
      };

      // Inject as early as possible
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.error("🔴 L2 Agent: Script injection error:", e);
    }
  }

  // Inject immediately
  injectMainWorldScript();

  // =============================================
  // LISTEN FOR MESSAGES FROM MAIN WORLD
  // =============================================
  window.addEventListener("message", function (event) {
    // Only accept messages from our main world script
    if (event.source !== window) return;
    if (!event.data || event.data.source !== "L2_AGENT_MAIN_WORLD") return;

    const { type, data: payload } = event.data;

    // Update session ID from main world
    if (payload.sessionId && !data.sessionId) {
      data.sessionId = payload.sessionId;
    }

    // Store locally for crash context
    switch (type) {
      case "console_error":
      case "console_warn":
        data.consoleErrors.push(payload);
        if (data.consoleErrors.length > 100) data.consoleErrors.shift();
        break;

      case "page_error":
      case "promise_rejection":
        data.pageErrors.push(payload);
        if (data.pageErrors.length > 50) data.pageErrors.shift();
        break;

      case "api_error":
        data.apiErrors.push(payload);
        if (data.apiErrors.length > 100) data.apiErrors.shift();
        break;

      case "api_request":
        data.apiRequests.push(payload);
        if (data.apiRequests.length > 200) data.apiRequests.shift();
        break;

      case "crash_detected":
        // Enrich crash with all collected context
        const enrichedCrash = {
          ...payload,
          recentConsoleErrors: data.consoleErrors.slice(-30),
          recentApiErrors: data.apiErrors.slice(-30),
          recentPageErrors: data.pageErrors.slice(-20),
          recentApiRequests: data.apiRequests.slice(-50),
        };
        data.crashes.push(enrichedCrash);

        // Forward enriched crash to background
        sendToBackground("crash_detected", enrichedCrash);
        requestScreenshot("crash");
        return;
    }

    // Forward to background
    sendToBackground(type, payload);

    // Request screenshot for errors
    if (type === "page_error" || type === "promise_rejection") {
      requestScreenshot(type);
    }
  });

  // =============================================
  // SEND TO BACKGROUND SERVICE WORKER
  // =============================================
  function sendToBackground(type, payload) {
    try {
      chrome.runtime.sendMessage({
        action: "logError",
        errorType: type,
        data: {
          ...payload,
          sessionId: data.sessionId || payload.sessionId,
          pageUrl: data.pageUrl,
        },
      });
    } catch (e) {
      console.log("🔴 L2 Agent: Send to background failed:", e.message);
    }
  }

  // =============================================
  // SCREENSHOT REQUEST
  // =============================================
  let lastScreenshot = 0;
  function requestScreenshot(reason) {
    if (Date.now() - lastScreenshot < 2000) return;
    lastScreenshot = Date.now();

    try {
      chrome.runtime.sendMessage({ action: "autoScreenshot", reason });
    } catch {}
  }

  // =============================================
  // MESSAGE HANDLER FROM BACKGROUND/POPUP
  // =============================================
  chrome.runtime.onMessage.addListener((req, sender, respond) => {
    switch (req.action) {
      case "enableTracking":
        respond({ success: true });
        break;

      case "getErrors":
        respond({
          success: true,
          data: {
            consoleErrors: data.consoleErrors,
            pageErrors: data.pageErrors,
            apiErrors: data.apiErrors,
            apiRequests: data.apiRequests,
            crashes: data.crashes,
            sessionId: data.sessionId,
            pageUrl: data.pageUrl,
          },
        });
        break;

      case "clearErrors":
        data.consoleErrors = [];
        data.pageErrors = [];
        data.apiErrors = [];
        data.apiRequests = [];
        data.crashes = [];
        respond({ success: true });
        break;

      case "captureNow":
        requestScreenshot("manual");
        respond({ success: true });
        break;

      case "triggerTestError":
        // Send test message to main world to trigger error
        window.postMessage(
          {
            source: "L2_AGENT_CONTENT",
            action: "triggerTestError",
          },
          "*"
        );
        respond({ success: true });
        break;

      default:
        respond({ success: false });
    }
    return true;
  });

  console.log(
    "🟢 L2 Agent: Content script ready, waiting for main world messages"
  );
})();
