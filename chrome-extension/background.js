// L2 Agent - Background Service Worker
// Stores all errors and handles screenshots with comprehensive logging

let isTrackingEnabled = false;

// Error storage with enhanced structure
const db = {
  crashes: [],
  apiErrors: [],
  apiRequests: [],
  consoleErrors: [],
  pageErrors: [],
  screenshots: [],
  // Session tracking for correlation
  sessions: {},
};

// =============================================
// INIT
// =============================================
chrome.runtime.onInstalled.addListener((details) => {
  console.log("L2 Agent installed:", details.reason);

  if (details.reason === "install") {
    chrome.storage.local.set({
      userConsent: false,
      trackingEnabled: false,
    });
  }

  loadFromStorage();
});

// Load state when service worker starts (including after browser restart)
chrome.runtime.onStartup.addListener(() => {
  console.log("L2 Agent: Browser started, loading state...");
  loadFromStorage();
});

// Also load on service worker activation
loadFromStorage();

async function loadFromStorage() {
  try {
    const result = await chrome.storage.local.get([
      "errorDb",
      "userConsent",
      "trackingEnabled",
    ]);
    if (result.errorDb) {
      Object.assign(db, result.errorDb);
    }
    isTrackingEnabled =
      result.userConsent === true && result.trackingEnabled !== false;
    updateBadge();
    console.log("L2 Agent: Loaded, tracking:", isTrackingEnabled);
  } catch (e) {
    console.error("Load error:", e);
  }
}

async function saveToStorage() {
  try {
    const data = {
      crashes: db.crashes.slice(-50),
      apiErrors: db.apiErrors.slice(-200),
      apiRequests: db.apiRequests.slice(-200),
      consoleErrors: db.consoleErrors.slice(-200),
      pageErrors: db.pageErrors.slice(-100),
      screenshots: db.screenshots.slice(-30),
      sessions: db.sessions,
    };
    await chrome.storage.local.set({ errorDb: data });
  } catch (e) {
    console.error("Save error:", e);
  }
}

// Auto-save every 10 seconds
setInterval(saveToStorage, 10000);

// =============================================
// SESSION TRACKING
// =============================================
function getOrCreateSession(sessionId, pageUrl) {
  if (!sessionId) return null;

  if (!db.sessions[sessionId]) {
    db.sessions[sessionId] = {
      id: sessionId,
      startTime: new Date().toISOString(),
      pageUrl,
      errorCount: 0,
      apiErrorCount: 0,
      crashCount: 0,
    };
  }
  return db.sessions[sessionId];
}

function updateSessionStats(sessionId, type) {
  const session = db.sessions[sessionId];
  if (!session) return;

  switch (type) {
    case "page_error":
    case "console_error":
    case "promise_rejection":
      session.errorCount++;
      break;
    case "api_error":
      session.apiErrorCount++;
      break;
    case "crash_detected":
      session.crashCount++;
      break;
  }
}

// =============================================
// MESSAGE HANDLING
// =============================================
chrome.runtime.onMessage.addListener((req, sender, respond) => {
  const tabId = sender.tab?.id;
  const tabUrl = sender.tab?.url || "";

  console.log("L2 BG:", req.action, req.errorType || "");

  switch (req.action) {
    // Tracking control
    case "setTrackingEnabled":
      isTrackingEnabled = req.enabled;
      console.log("L2 BG: Tracking state changed to:", isTrackingEnabled);
      // Save the state immediately
      chrome.storage.local.set({ trackingEnabled: req.enabled }).catch(e => {
        console.error("L2 BG: Failed to save tracking state", e);
      });
      updateBadge();
      respond({ success: true });
      break;

    // Log error from content script
    case "logError":
      handleError(req.errorType, req.data, tabId, tabUrl);
      respond({ success: true });
      break;

    // Get all stored errors
    case "getStoredErrors":
      respond({
        success: true,
        data: {
          crashes: db.crashes,
          apiErrors: db.apiErrors,
          apiRequests: db.apiRequests,
          consoleErrors: db.consoleErrors,
          pageErrors: db.pageErrors,
          screenshots: db.screenshots,
          sessions: db.sessions,
          stats: {
            totalCrashes: db.crashes.length,
            totalApiErrors: db.apiErrors.length,
            totalApiRequests: db.apiRequests.length,
            totalConsoleErrors: db.consoleErrors.length,
            totalPageErrors: db.pageErrors.length,
            totalScreenshots: db.screenshots.length,
          },
        },
      });
      break;

    // Screenshot
    case "captureScreenshot":
    case "autoScreenshot":
      captureScreenshot(tabId, req.reason || "manual")
        .then((ss) => respond({ success: true, screenshot: ss }))
        .catch((e) => respond({ success: false, error: e.message }));
      return true;

    // Export - Enhanced with full context
    case "exportErrors":
      respond({
        success: true,
        data: generateExport(),
      });
      break;

    // Export for MCP Server (LLM-optimized format)
    case "exportForMCP":
      respond({
        success: true,
        data: generateMCPExport(),
      });
      break;

    // Generate ticket
    case "createTicket":
      respond({ success: true, ticket: generateTicket() });
      break;

    // Clear all
    case "clearAllErrors":
      db.crashes = [];
      db.apiErrors = [];
      db.apiRequests = [];
      db.consoleErrors = [];
      db.pageErrors = [];
      db.screenshots = [];
      db.sessions = {};
      saveToStorage();
      updateBadge();
      respond({ success: true });
      break;

    default:
      respond({ success: false, error: "Unknown action" });
  }

  return true;
});

// =============================================
// ERROR HANDLING - Enhanced
// =============================================
function handleError(type, data, tabId, tabUrl) {
  // Check if tracking is enabled
  if (!isTrackingEnabled) {
    console.log("L2 Agent: Tracking disabled, ignoring error:", type);
    return;
  }

  const entry = {
    id: genId(),
    tabId,
    tabUrl,
    errorType: type,
    ...data,
    receivedAt: new Date().toISOString(),
  };

  // Update session tracking
  if (data.sessionId) {
    getOrCreateSession(data.sessionId, data.pageUrl);
    updateSessionStats(data.sessionId, type);
  }

  console.log(`L2 Agent: Storing ${type}`, {
    message: data.message?.slice(0, 100),
    url: data.url,
    sessionId: data.sessionId,
  });

  switch (type) {
    case "crash_detected":
      // Ensure crash has all related logs attached
      const enrichedCrash = enrichCrashData(entry);
      db.crashes.push(enrichedCrash);
      captureScreenshot(tabId, "crash").catch(() => {});
      notify("Page Crash", `Crash detected on ${new URL(tabUrl).hostname}`);
      break;

    case "api_error":
    case "resource_error":
      db.apiErrors.push(entry);
      if (type === "api_error" && entry.type !== "resource_error") {
        db.apiRequests.push(entry); // Also add to all requests
        if (db.apiRequests.length > 200) db.apiRequests.shift();
      }
      break;

    case "api_request":
      db.apiRequests.push(entry);
      if (db.apiRequests.length > 200) db.apiRequests.shift();
      break;

    case "console_error":
    case "console_warn":
      db.consoleErrors.push(entry);
      break;

    case "page_error":
    case "promise_rejection":
      db.pageErrors.push(entry);
      captureScreenshot(tabId, type).catch(() => {});
      break;
  }

  // Trim
  if (db.crashes.length > 50) db.crashes.shift();
  if (db.apiErrors.length > 200) db.apiErrors.shift();
  if (db.consoleErrors.length > 200) db.consoleErrors.shift();
  if (db.pageErrors.length > 100) db.pageErrors.shift();

  updateBadge();
  saveToStorage();
}

// =============================================
// ENRICH CRASH DATA - Ensure all related logs are attached
// =============================================
function enrichCrashData(crashEntry) {
  const sessionId = crashEntry.sessionId;
  const pageUrl = crashEntry.pageUrl || crashEntry.tabUrl;
  const timestamp = new Date(crashEntry.timestamp);
  const lookbackMs = 60000; // Look back 60 seconds for related errors

  // If crash already has recent errors, use them; otherwise collect from db
  if (!crashEntry.recentConsoleErrors?.length) {
    crashEntry.recentConsoleErrors = db.consoleErrors
      .filter((e) => {
        const matchesSession = !sessionId || e.sessionId === sessionId;
        const matchesUrl =
          !pageUrl || e.pageUrl === pageUrl || e.url === pageUrl;
        const isRecent =
          new Date(e.timestamp) > new Date(timestamp - lookbackMs);
        return matchesSession && (matchesUrl || isRecent);
      })
      .slice(-30);
  }

  if (!crashEntry.recentApiErrors?.length) {
    crashEntry.recentApiErrors = db.apiErrors
      .filter((e) => {
        const matchesSession = !sessionId || e.sessionId === sessionId;
        const isRecent =
          new Date(e.timestamp) > new Date(timestamp - lookbackMs);
        return matchesSession || isRecent;
      })
      .slice(-30);
  }

  if (!crashEntry.recentPageErrors?.length) {
    crashEntry.recentPageErrors = db.pageErrors
      .filter((e) => {
        const matchesSession = !sessionId || e.sessionId === sessionId;
        const matchesUrl =
          !pageUrl || e.pageUrl === pageUrl || e.url === pageUrl;
        const isRecent =
          new Date(e.timestamp) > new Date(timestamp - lookbackMs);
        return matchesSession && (matchesUrl || isRecent);
      })
      .slice(-20);
  }

  if (!crashEntry.recentApiRequests?.length) {
    crashEntry.recentApiRequests = db.apiRequests
      .filter((e) => {
        const matchesSession = !sessionId || e.sessionId === sessionId;
        const isRecent =
          new Date(e.timestamp) > new Date(timestamp - lookbackMs);
        return matchesSession || isRecent;
      })
      .slice(-50);
  }

  return crashEntry;
}

// =============================================
// EXPORT GENERATION - Enhanced
// =============================================
function generateExport() {
  return {
    exportedAt: new Date().toISOString(),
    version: "2.0",
    summary: {
      totalCrashes: db.crashes.length,
      totalApiErrors: db.apiErrors.length,
      totalConsoleErrors: db.consoleErrors.length,
      totalPageErrors: db.pageErrors.length,
      totalApiRequests: db.apiRequests.length,
      totalScreenshots: db.screenshots.length,
      sessionsTracked: Object.keys(db.sessions).length,
    },
    crashes: db.crashes.map((crash) => ({
      ...crash,
      // Ensure each crash has full context
      recentConsoleErrors: crash.recentConsoleErrors || [],
      recentApiErrors: crash.recentApiErrors || [],
      recentPageErrors: crash.recentPageErrors || [],
      recentApiRequests: crash.recentApiRequests || [],
    })),
    apiErrors: db.apiErrors,
    apiRequests: db.apiRequests,
    consoleErrors: db.consoleErrors,
    pageErrors: db.pageErrors,
    screenshots: db.screenshots.map((s) => ({
      ...s,
      dataUrl: "[image]", // Truncate for export size
    })),
    sessions: db.sessions,
  };
}

// =============================================
// MCP EXPORT - LLM-Optimized Format for Analysis
// =============================================
function generateMCPExport() {
  const now = new Date();

  // Sort all events by timestamp for timeline
  const allEvents = [
    ...db.pageErrors.map((e) => ({ ...e, _category: "PAGE_ERROR" })),
    ...db.consoleErrors.map((e) => ({ ...e, _category: "CONSOLE_ERROR" })),
    ...db.apiErrors.map((e) => ({ ...e, _category: "API_ERROR" })),
    ...db.crashes.map((e) => ({ ...e, _category: "CRASH" })),
  ].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

  // Group errors by likely root cause (same error type + message pattern)
  const errorGroups = groupErrorsByRootCause(db.pageErrors, db.consoleErrors);

  return {
    _format: "L2_AGENT_MCP_V1",
    _description:
      "Error data optimized for LLM analysis. Use this to identify root causes of crashes and errors.",

    metadata: {
      exportedAt: now.toISOString(),
      pageUrl: db.crashes[0]?.pageUrl || db.pageErrors[0]?.url || "unknown",
      sessionCount: Object.keys(db.sessions).length,
      timeRange: {
        earliest: allEvents[0]?.timestamp || null,
        latest: allEvents[allEvents.length - 1]?.timestamp || null,
      },
    },

    // Executive summary for quick understanding
    summary: {
      totalCrashes: db.crashes.length,
      totalPageErrors: db.pageErrors.length,
      totalConsoleErrors: db.consoleErrors.length,
      totalApiErrors: db.apiErrors.length,
      totalApiRequests: db.apiRequests.length,
      uniqueErrorTypes: [
        ...new Set([
          ...db.pageErrors.map((e) => e.errorType),
          ...db.consoleErrors.map((e) => e.errorType),
        ]),
      ].filter(Boolean),
      failedEndpoints: [
        ...new Set(db.apiErrors.map((e) => `${e.method} ${e.url}`)),
      ],
    },

    // Primary errors - most likely root causes
    primaryErrors: errorGroups.slice(0, 10).map((group) => ({
      errorType: group.errorType,
      message: group.message,
      occurrences: group.count,
      firstSeen: group.firstSeen,
      lastSeen: group.lastSeen,
      stack: group.stack,
      filename: group.filename,
      lineno: group.lineno,
      colno: group.colno,
      // Context for debugging
      relatedApiCalls: findRelatedApiCalls(group.timestamp),
    })),

    // Crashes with full context
    crashes: db.crashes.map((crash) => ({
      timestamp: crash.timestamp,
      url: crash.pageUrl || crash.url,
      detectionMethod: crash.reason,
      displayedErrorText: crash.text,

      // The actual errors that caused this crash
      rootCauseErrors: (crash.recentPageErrors || []).map((e) => ({
        type: e.errorType,
        message: e.message,
        file: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : null,
        stack: e.stack,
      })),

      // Console errors around crash time
      consoleContext: (crash.recentConsoleErrors || []).map((e) => ({
        type: e.errorType,
        message: e.message,
        stack: e.stack,
      })),

      // API state at crash time
      apiContext: {
        errors: (crash.recentApiErrors || []).map((e) => ({
          method: e.method,
          url: e.url,
          status: e.status,
          error: e.error || e.errorDetails?.message,
          responseBody: e.responseBody?.slice(0, 500),
        })),
        recentRequests: (crash.recentApiRequests || []).slice(-10).map((e) => ({
          method: e.method,
          url: e.url,
          status: e.status,
          duration: e.duration,
          isError: e.isError,
        })),
      },
    })),

    // Timeline of events (for understanding sequence)
    timeline: allEvents.slice(-50).map((e) => ({
      time: e.timestamp,
      category: e._category,
      type: e.errorType || e.type,
      message: (e.message || "").slice(0, 200),
      url: e.url,
      ...(e._category === "API_ERROR"
        ? {
            endpoint: `${e.method} ${e.status} ${e.url}`,
            responseBody: e.responseBody?.slice(0, 300),
          }
        : {}),
    })),

    // Raw data for deep analysis
    rawData: {
      pageErrors: db.pageErrors.map((e) => ({
        timestamp: e.timestamp,
        errorType: e.errorType,
        message: e.message,
        filename: e.filename,
        lineno: e.lineno,
        colno: e.colno,
        stack: e.stack,
        url: e.url,
      })),
      consoleErrors: db.consoleErrors.map((e) => ({
        timestamp: e.timestamp,
        errorType: e.errorType,
        type: e.type,
        message: e.message,
        stack: e.stack,
        url: e.url,
      })),
      apiErrors: db.apiErrors.map((e) => ({
        timestamp: e.timestamp,
        method: e.method,
        url: e.url,
        status: e.status,
        statusText: e.statusText,
        error: e.error,
        errorDetails: e.errorDetails,
        requestBody: e.requestBody?.slice(0, 1000),
        responseBody: e.responseBody?.slice(0, 2000),
        duration: e.duration,
        traceId: e.traceId,
        traceIdHeader: e.traceIdHeader,
      })),
      apiRequests: db.apiRequests.slice(-100).map((e) => ({
        timestamp: e.timestamp,
        method: e.method,
        url: e.url,
        status: e.status,
        duration: e.duration,
        isError: e.isError,
        traceId: e.traceId,
      })),
    },

    // Analysis hints for LLM
    _analysisHints: {
      lookFor: [
        "Check primaryErrors for the most likely root cause",
        "Look at stack traces to identify the failing component/function",
        "Check if API errors preceded the crash (missing data causing render failures)",
        "Look for undefined/null reference errors (component not found, data not loaded)",
        "Check timeline to understand the sequence of events",
      ],
      commonPatterns: [
        "ReferenceError: X is not defined → Missing import or component not registered",
        "TypeError: Cannot read property of undefined → Data not loaded or null check missing",
        "ChunkLoadError → Code splitting/lazy loading failure",
        "NetworkError → API connectivity issues",
        "API 401/403 → Authentication/authorization issues",
        "API 500 → Server-side error",
      ],
    },
  };
}

// Group similar errors together to find root causes
function groupErrorsByRootCause(pageErrors, consoleErrors) {
  const groups = {};

  [...pageErrors, ...consoleErrors].forEach((error) => {
    // Create a key from error type + first line of message
    const messageKey = (error.message || "").split("\n")[0].slice(0, 100);
    const key = `${error.errorType}:${messageKey}`;

    if (!groups[key]) {
      groups[key] = {
        errorType: error.errorType,
        message: error.message,
        stack: error.stack,
        filename: error.filename,
        lineno: error.lineno,
        colno: error.colno,
        count: 0,
        firstSeen: error.timestamp,
        lastSeen: error.timestamp,
        timestamp: error.timestamp,
      };
    }

    groups[key].count++;
    groups[key].lastSeen = error.timestamp;
  });

  return Object.values(groups).sort((a, b) => b.count - a.count);
}

// Find API calls that happened around the same time as an error
function findRelatedApiCalls(errorTimestamp) {
  if (!errorTimestamp) return [];

  const errorTime = new Date(errorTimestamp).getTime();
  const windowMs = 5000; // 5 second window

  return db.apiRequests
    .filter((req) => {
      const reqTime = new Date(req.timestamp).getTime();
      return Math.abs(reqTime - errorTime) < windowMs;
    })
    .slice(-5)
    .map((req) => ({
      method: req.method,
      url: req.url,
      status: req.status,
      isError: req.isError,
    }));
}

// =============================================
// SCREENSHOT
// =============================================
let lastScreenshotTime = 0;

async function captureScreenshot(tabId, reason) {
  // Throttle
  if (Date.now() - lastScreenshotTime < 1000) {
    return null;
  }
  lastScreenshotTime = Date.now();

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: "png",
      quality: 80,
    });

    const ss = {
      id: genId(),
      tabId,
      reason,
      dataUrl,
      timestamp: new Date().toISOString(),
    };

    db.screenshots.push(ss);
    if (db.screenshots.length > 30) db.screenshots.shift();

    console.log("L2 Agent: Screenshot captured for", reason);
    return ss;
  } catch (e) {
    console.log("Screenshot failed:", e.message);
    return null;
  }
}

// =============================================
// TICKET GENERATION - Enhanced with better formatting
// =============================================
function generateTicket() {
  const recentCrashes = db.crashes.slice(-5);
  const recentApiErrors = db.apiErrors.slice(-10);
  const recentConsoleErrors = db.consoleErrors.slice(-10);
  const recentPageErrors = db.pageErrors.slice(-10);

  const md = `# Bug Report - L2 Agent

**Generated:** ${new Date().toISOString()}

## Summary
- Crashes: ${db.crashes.length}
- API Errors: ${db.apiErrors.length}
- Console Errors: ${db.consoleErrors.length}
- Page Errors: ${db.pageErrors.length}
- API Requests Logged: ${db.apiRequests.length}
- Screenshots: ${db.screenshots.length}

## Crashes
${recentCrashes
  .map(
    (c, i) => `
### Crash ${i + 1}
- **Time:** ${c.timestamp}
- **URL:** ${c.pageUrl || c.tabUrl || c.url}
- **Reason:** ${c.reason || "Unknown"}
- **Detected Element Text:** ${c.text?.slice(0, 200) || "N/A"}

**Related Console Errors (${c.recentConsoleErrors?.length || 0}):**
${
  (c.recentConsoleErrors || [])
    .slice(-5)
    .map((e) => `- ${e.errorType}: ${e.message?.slice(0, 100)}`)
    .join("\n") || "None captured"
}

**Related Page Errors (${c.recentPageErrors?.length || 0}):**
${
  (c.recentPageErrors || [])
    .slice(-5)
    .map(
      (e) =>
        `- ${e.errorType}: ${e.message?.slice(0, 100)} (${e.filename}:${
          e.lineno
        })`
    )
    .join("\n") || "None captured"
}

**Related API Errors (${c.recentApiErrors?.length || 0}):**
${
  (c.recentApiErrors || [])
    .slice(-5)
    .map((e) => `- ${e.method} ${e.status} ${e.url?.slice(0, 80)}`)
    .join("\n") || "None captured"
}
`
  )
  .join("\n---\n")}

## Recent API Errors
${recentApiErrors
  .map(
    (e) => `
- **${e.method || "?"} ${e.url?.slice(0, 100)}**
  - Status: ${e.status} ${e.statusText || ""}
  - Error: ${e.error || e.errorDetails?.message || "N/A"}
  - Trace ID: ${e.traceId || "N/A"}${
      e.traceIdHeader ? ` (${e.traceIdHeader})` : ""
    }
  - Time: ${e.timestamp}
`
  )
  .join("\n")}

## Recent Console Errors
${recentConsoleErrors
  .map(
    (e) => `
- **${e.errorType || e.type}**: ${e.message?.slice(0, 200)}
  - Time: ${e.timestamp}
  - URL: ${e.url || "N/A"}
${e.stack ? `  - Stack: \`${e.stack.split("\n")[0]}\`` : ""}
`
  )
  .join("\n")}

## Recent Page Errors (Uncaught)
${recentPageErrors
  .map(
    (e) => `
- **${e.errorType || e.type}**: ${e.message?.slice(0, 200)}
  - File: ${e.filename || "N/A"}:${e.lineno || 0}:${e.colno || 0}
  - Time: ${e.timestamp}
${
  e.stack
    ? `  - Stack: \`${e.stack.split("\n").slice(0, 3).join(" -> ")}\``
    : ""
}
`
  )
  .join("\n")}

## Screenshots
${db.screenshots.length} screenshot(s) captured.

---
*L2 Agent Error Tracker v2.0*
`;

  return {
    markdown: md,
    json: {
      crashes: recentCrashes,
      apiErrors: recentApiErrors,
      consoleErrors: recentConsoleErrors,
      pageErrors: recentPageErrors,
      screenshots: db.screenshots
        .slice(-5)
        .map((s) => ({ ...s, dataUrl: "[image]" })),
    },
  };
}

// =============================================
// UTILITIES
// =============================================
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
}

function updateBadge() {
  const count = db.crashes.length + db.pageErrors.length;
  const text = count > 0 ? (count > 99 ? "99+" : String(count)) : "";
  const color = db.crashes.length > 0 ? "#ef4444" : "#f97316";

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

function notify(title, message) {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message,
    });
  } catch {}
}

// Init
loadFromStorage();
console.log("L2 Agent: Background started v2.0");
