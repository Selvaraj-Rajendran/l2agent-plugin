// L2 Agent - Main World Script
// This runs in the page's JavaScript context to capture REAL errors
// Communicates with content.js via window.postMessage

(function () {
  "use strict";

  if (window.__L2AgentMainWorldInjected) return;
  window.__L2AgentMainWorldInjected = true;

  // Store originals FIRST before anything else can override them
  const _log = console.log.bind(console);
  const _error = console.error.bind(console);
  const _warn = console.warn.bind(console);
  const _debug = console.debug?.bind(console) || _log;
  const _assert = console.assert?.bind(console) || (() => {});
  const _XHR = window.XMLHttpRequest;
  const _fetch = window.fetch;

  const SESSION_ID = `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const START_TIME = Date.now();

  // Local error storage for crash context
  const localErrors = {
    page: [],
    console: [],
    api: [],
    apiRequests: [],
  };

  _log("🔵 L2 Agent: Main world injection started", { sessionId: SESSION_ID });

  // =============================================
  // SEND TO CONTENT SCRIPT (via postMessage)
  // =============================================
  function sendToContentScript(type, data) {
    try {
      window.postMessage(
        {
          source: "L2_AGENT_MAIN_WORLD",
          type,
          data: {
            ...data,
            sessionId: SESSION_ID,
            pageUrl: location.href,
          },
        },
        "*"
      );
    } catch (e) {
      _log("L2 Agent: postMessage failed", e.message);
    }
  }

  // =============================================
  // ERROR EXTRACTION - Comprehensive
  // =============================================
  function extractErrorInfo(arg, depth = 0) {
    if (depth > 3) return { message: "[Max depth reached]", type: "unknown" };

    if (arg === null) return { message: "null", type: "null" };
    if (arg === undefined) return { message: "undefined", type: "undefined" };

    // Handle Error objects comprehensively
    if (arg instanceof Error) {
      return {
        type: arg.name || "Error",
        message: arg.message || "No message",
        stack: arg.stack || "",
        cause: arg.cause
          ? extractErrorInfo(arg.cause, depth + 1).message
          : undefined,
        code: arg.code,
        fileName: arg.fileName,
        lineNumber: arg.lineNumber,
        columnNumber: arg.columnNumber,
        componentStack: arg.componentStack,
      };
    }

    // Handle ErrorEvent
    if (arg instanceof ErrorEvent) {
      return {
        type: arg.error?.name || "ErrorEvent",
        message: arg.message || arg.error?.message || "ErrorEvent",
        stack: arg.error?.stack || "",
        filename: arg.filename,
        lineno: arg.lineno,
        colno: arg.colno,
      };
    }

    // Handle DOMException
    if (arg instanceof DOMException) {
      return {
        type: "DOMException",
        message: arg.message,
        name: arg.name,
        code: arg.code,
      };
    }

    // Handle objects
    if (typeof arg === "object" && arg !== null) {
      if (arg.componentStack) {
        return {
          type: "ReactError",
          message: arg.message || String(arg),
          componentStack: arg.componentStack,
          stack: arg.error?.stack || arg.stack || "",
        };
      }

      if (arg.message !== undefined) {
        return {
          type: arg.name || arg.type || "ObjectError",
          message: String(arg.message),
          stack: arg.stack || "",
          code: arg.code,
        };
      }

      if (arg.error) return extractErrorInfo(arg.error, depth + 1);
      if (arg.reason) return extractErrorInfo(arg.reason, depth + 1);

      try {
        const str = JSON.stringify(arg);
        if (str && str !== "{}") {
          return { type: "Object", message: str.slice(0, 2000) };
        }
      } catch {}

      return { type: arg.constructor?.name || "Object", message: String(arg) };
    }

    return { type: typeof arg, message: String(arg) };
  }

  function formatArgs(args) {
    return args
      .map((arg) => {
        const info = extractErrorInfo(arg);
        if (info.stack) {
          return `${info.type}: ${info.message}\n${info.stack}`;
        }
        return info.message;
      })
      .join(" ");
  }

  function getCurrentStack() {
    try {
      const err = new Error();
      return err.stack?.split("\n").slice(2).join("\n") || "";
    } catch {
      return "";
    }
  }

  // =============================================
  // CRASH DETECTION - Error-based (not just UI)
  // =============================================

  // Patterns that indicate a crash/fatal error
  const CRASH_ERROR_PATTERNS = [
    /is not defined$/i,
    /is not a function$/i,
    /cannot read propert/i,
    /cannot set propert/i,
    /undefined is not/i,
    /null is not/i,
    /maximum call stack/i,
    /out of memory/i,
    /chunk.*failed/i,
    /loading chunk/i,
    /dynamically imported module/i,
    /failed to fetch/i,
  ];

  const CRASH_ERROR_TYPES = [
    "ReferenceError",
    "TypeError",
    "ChunkLoadError",
    "SyntaxError",
  ];

  // Track errors for crash detection
  let recentCriticalErrors = [];
  let crashTriggered = false;

  function isCriticalError(errorType, message) {
    // Check error type
    if (CRASH_ERROR_TYPES.includes(errorType)) {
      return true;
    }

    // Check message patterns
    for (const pattern of CRASH_ERROR_PATTERNS) {
      if (pattern.test(message)) {
        return true;
      }
    }

    return false;
  }

  function checkForErrorBasedCrash(entry) {
    const isCritical = isCriticalError(entry.errorType, entry.message);

    if (isCritical) {
      recentCriticalErrors.push({
        ...entry,
        capturedAt: Date.now(),
      });

      // Keep only last 60 seconds of errors
      const cutoff = Date.now() - 60000;
      recentCriticalErrors = recentCriticalErrors.filter(
        (e) => e.capturedAt > cutoff
      );

      // Trigger crash if:
      // 1. We have a ReferenceError (usually component not found)
      // 2. We have multiple critical errors in quick succession
      // 3. We detect specific crash patterns

      const shouldTriggerCrash =
        entry.errorType === "ReferenceError" ||
        entry.message?.includes("is not defined") ||
        entry.componentStack || // React error boundary
        recentCriticalErrors.length >= 3;

      if (shouldTriggerCrash && !crashTriggered) {
        triggerCrashFromError(entry);
      }
    }
  }

  function triggerCrashFromError(primaryError) {
    crashTriggered = true;

    _log(
      "🔴 L2 CRASH DETECTED (from error):",
      primaryError.errorType,
      primaryError.message?.slice(0, 100)
    );

    sendToContentScript("crash_detected", {
      type: "crash",
      detected: true,
      reason: `Error: ${primaryError.errorType} - ${primaryError.message?.slice(
        0,
        100
      )}`,
      detectionMethod: "error_based",

      // The primary error that caused the crash
      primaryError: {
        type: primaryError.errorType,
        message: primaryError.message,
        stack: primaryError.stack,
        filename: primaryError.filename,
        lineno: primaryError.lineno,
        colno: primaryError.colno,
        componentStack: primaryError.componentStack,
      },

      // All recent critical errors
      recentCriticalErrors: recentCriticalErrors.slice(-10),

      // Context from local storage
      recentConsoleErrors: localErrors.console.slice(-30),
      recentPageErrors: localErrors.page.slice(-20),
      recentApiErrors: localErrors.api.slice(-30),
      recentApiRequests: localErrors.apiRequests.slice(-50),

      timestamp: new Date().toISOString(),
      url: location.href,
      sessionDuration: Date.now() - START_TIME,
    });

    // Reset after a delay to allow detecting new crashes
    setTimeout(() => {
      crashTriggered = false;
      recentCriticalErrors = [];
    }, 10000);
  }

  // =============================================
  // 1. CONSOLE.ERROR
  // =============================================
  console.error = function (...args) {
    const errorInfos = args.map((arg) => extractErrorInfo(arg));
    const primaryError = errorInfos.find((e) => e.stack) || errorInfos[0] || {};

    const entry = {
      type: "console.error",
      errorType: primaryError.type || "console.error",
      message: formatArgs(args),
      stack: primaryError.stack || getCurrentStack(),
      componentStack: primaryError.componentStack,
      timestamp: new Date().toISOString(),
      url: location.href,
    };

    // Store locally for crash context
    localErrors.console.push(entry);
    if (localErrors.console.length > 100) localErrors.console.shift();

    sendToContentScript("console_error", entry);

    // Check if this error should trigger a crash
    checkForErrorBasedCrash(entry);

    _log("🔴 L2 captured console.error:", entry.message.slice(0, 150));
    _error.apply(console, args);
  };

  // =============================================
  // 2. CONSOLE.WARN
  // =============================================
  console.warn = function (...args) {
    const message = formatArgs(args);

    const entry = {
      type: "console.warn",
      errorType: "Warning",
      message,
      stack: getCurrentStack(),
      timestamp: new Date().toISOString(),
      url: location.href,
    };

    localErrors.console.push(entry);
    if (localErrors.console.length > 100) localErrors.console.shift();

    sendToContentScript("console_warn", entry);

    _warn.apply(console, args);
  };

  // =============================================
  // 3. CONSOLE.ASSERT
  // =============================================
  console.assert = function (condition, ...args) {
    if (!condition) {
      const message = args.length > 0 ? formatArgs(args) : "Assertion failed";

      const entry = {
        type: "console.assert",
        errorType: "AssertionError",
        message,
        stack: getCurrentStack(),
        timestamp: new Date().toISOString(),
        url: location.href,
      };

      localErrors.console.push(entry);
      sendToContentScript("console_error", entry);
      _log("🔴 L2 captured assertion failure:", message.slice(0, 100));
    }
    _assert.apply(console, [condition, ...args]);
  };

  // =============================================
  // 4. WINDOW ERROR - Captures uncaught errors
  // =============================================
  window.addEventListener(
    "error",
    function (e) {
      let errorInfo = { type: "Error", message: "Unknown error", stack: "" };

      // Extract from error object
      if (e.error) {
        errorInfo = extractErrorInfo(e.error);
      } else if (e.message) {
        errorInfo = {
          type: "Error",
          message: e.message,
          filename: e.filename,
          lineno: e.lineno,
          colno: e.colno,
        };
      }

      const entry = {
        type: "uncaught_error",
        errorType: errorInfo.type || "Error",
        message: errorInfo.message || e.message || "Unknown error",
        filename: e.filename || errorInfo.fileName || "",
        lineno: e.lineno || errorInfo.lineNumber || 0,
        colno: e.colno || errorInfo.columnNumber || 0,
        stack: errorInfo.stack || e.error?.stack || "",
        componentStack: errorInfo.componentStack,
        timestamp: new Date().toISOString(),
        url: location.href,
      };

      // Store locally
      localErrors.page.push(entry);
      if (localErrors.page.length > 50) localErrors.page.shift();

      sendToContentScript("page_error", entry);

      // Check if this should trigger a crash
      checkForErrorBasedCrash(entry);

      _log(
        "🔴 L2 captured uncaught error:",
        entry.message,
        entry.filename,
        entry.lineno
      );
    },
    true
  );

  // =============================================
  // 5. UNHANDLED PROMISE REJECTION
  // =============================================
  window.addEventListener("unhandledrejection", function (e) {
    const errorInfo = extractErrorInfo(e.reason);

    const entry = {
      type: "unhandled_rejection",
      errorType: errorInfo.type || "PromiseRejection",
      message: errorInfo.message || "Promise rejected",
      stack: errorInfo.stack || "",
      componentStack: errorInfo.componentStack,
      reason:
        typeof e.reason === "object"
          ? JSON.stringify(e.reason, null, 2)?.slice(0, 2000)
          : String(e.reason),
      timestamp: new Date().toISOString(),
      url: location.href,
    };

    localErrors.page.push(entry);
    if (localErrors.page.length > 50) localErrors.page.shift();

    sendToContentScript("promise_rejection", entry);

    // Check if this should trigger a crash
    checkForErrorBasedCrash(entry);

    _log("🔴 L2 captured promise rejection:", entry.message);
  });

  // =============================================
  // 6. XHR INTERCEPTION
  // =============================================
  window.XMLHttpRequest = function () {
    const xhr = new _XHR();
    const req = { method: "", url: "", start: 0, headers: {} };

    const _open = xhr.open.bind(xhr);
    xhr.open = function (method, url, ...rest) {
      req.method = method;
      req.url = String(url);
      return _open(method, url, ...rest);
    };

    const _setRequestHeader = xhr.setRequestHeader.bind(xhr);
    xhr.setRequestHeader = function (name, value) {
      req.headers[name] = value;
      return _setRequestHeader(name, value);
    };

    const _send = xhr.send.bind(xhr);
    xhr.send = function (body) {
      req.start = Date.now();
      req.body = body ? String(body).slice(0, 2000) : null;

      xhr.addEventListener("loadend", function () {
        let responseBody = "";
        try {
          responseBody = xhr.responseText?.slice(0, 5000) || "";
        } catch {}

        const entry = {
          type: "xhr",
          method: req.method,
          url: req.url,
          status: xhr.status,
          statusText: xhr.statusText,
          duration: Date.now() - req.start,
          requestBody: req.body,
          responseBody,
          isError: xhr.status === 0 || xhr.status >= 400,
          timestamp: new Date().toISOString(),
        };

        // Store locally
        localErrors.apiRequests.push(entry);
        if (localErrors.apiRequests.length > 200)
          localErrors.apiRequests.shift();

        sendToContentScript("api_request", entry);

        if (entry.isError) {
          let errorDetails = null;
          try {
            if (responseBody) errorDetails = JSON.parse(responseBody);
          } catch {}

          const errorEntry = { ...entry, errorDetails };
          localErrors.api.push(errorEntry);
          if (localErrors.api.length > 100) localErrors.api.shift();

          sendToContentScript("api_error", errorEntry);
        }

        _log(`🌐 L2 XHR: ${req.method} ${xhr.status} ${req.url.slice(0, 60)}`);
      });

      xhr.addEventListener("error", function () {
        const entry = {
          type: "xhr_network_error",
          method: req.method,
          url: req.url,
          status: 0,
          error: "Network error",
          duration: Date.now() - req.start,
          isError: true,
          timestamp: new Date().toISOString(),
        };

        localErrors.api.push(entry);
        sendToContentScript("api_error", entry);
      });

      xhr.addEventListener("timeout", function () {
        const entry = {
          type: "xhr_timeout",
          method: req.method,
          url: req.url,
          status: 0,
          error: "Request timeout",
          duration: Date.now() - req.start,
          isError: true,
          timestamp: new Date().toISOString(),
        };

        localErrors.api.push(entry);
        sendToContentScript("api_error", entry);
      });

      return _send(body);
    };

    return xhr;
  };

  // Copy static properties from original XMLHttpRequest
  Object.keys(_XHR).forEach((key) => {
    try {
      window.XMLHttpRequest[key] = _XHR[key];
    } catch {}
  });
  window.XMLHttpRequest.prototype = _XHR.prototype;

  // =============================================
  // 7. FETCH INTERCEPTION
  // =============================================
  window.fetch = async function (input, init = {}) {
    const url = typeof input === "string" ? input : input?.url || String(input);
    const method = init?.method || input?.method || "GET";
    const start = Date.now();

    let requestBody = null;
    try {
      if (init.body) {
        requestBody =
          typeof init.body === "string"
            ? init.body.slice(0, 2000)
            : "[Binary/FormData]";
      }
    } catch {}

    try {
      const response = await _fetch(input, init);
      const duration = Date.now() - start;

      let responseBody = "";
      try {
        const clone = response.clone();
        responseBody = (await clone.text()).slice(0, 5000);
      } catch {}

      const entry = {
        type: "fetch",
        method,
        url,
        status: response.status,
        statusText: response.statusText,
        duration,
        requestBody,
        responseBody,
        isError: !response.ok,
        timestamp: new Date().toISOString(),
      };

      // Store locally
      localErrors.apiRequests.push(entry);
      if (localErrors.apiRequests.length > 200) localErrors.apiRequests.shift();

      sendToContentScript("api_request", entry);

      if (!response.ok) {
        let errorDetails = null;
        try {
          if (responseBody) errorDetails = JSON.parse(responseBody);
        } catch {}

        const errorEntry = { ...entry, errorDetails };
        localErrors.api.push(errorEntry);
        if (localErrors.api.length > 100) localErrors.api.shift();

        sendToContentScript("api_error", errorEntry);
      }

      _log(`🌐 L2 Fetch: ${method} ${response.status} ${url.slice(0, 60)}`);
      return response;
    } catch (err) {
      const entry = {
        type: "fetch_error",
        method,
        url,
        status: 0,
        error: err.message,
        errorType: err.name,
        errorStack: err.stack,
        duration: Date.now() - start,
        isError: true,
        timestamp: new Date().toISOString(),
      };

      localErrors.api.push(entry);
      sendToContentScript("api_error", entry);
      _log(`🔴 L2 Fetch Error: ${method} ${url.slice(0, 60)} - ${err.message}`);
      throw err;
    }
  };

  // =============================================
  // 8. DOM-BASED CRASH DETECTION (backup)
  // =============================================
  const CRASH_SELECTORS = [
    '[class*="error-page"]',
    '[class*="error-screen"]',
    '[class*="crash"]',
    '[class*="something-went-wrong"]',
    '[data-testid*="error"]',
    ".error-boundary",
    '[class*="fatal-error"]',
    '[class*="app-error"]',
    '[class*="server-error"]',
    '[class*="ErrorBoundary"]',
    '[role="alert"][class*="error"]',
  ];

  function detectDOMCrash() {
    for (const sel of CRASH_SELECTORS) {
      try {
        const el = document.querySelector(sel);
        if (el && el.offsetParent !== null) {
          const text = el.innerText?.trim() || "";
          if (text.length < 5) continue;

          return {
            detected: true,
            reason: `Element: ${sel}`,
            text: text.slice(0, 500),
            html: el.outerHTML?.slice(0, 1000) || "",
          };
        }
      } catch {}
    }
    return { detected: false };
  }

  let lastDOMCrashReason = null;
  function checkForDOMCrash() {
    const crash = detectDOMCrash();
    if (crash.detected && crash.reason !== lastDOMCrashReason) {
      lastDOMCrashReason = crash.reason;

      // Only trigger if we haven't already detected via error
      if (!crashTriggered) {
        _log("🔴 L2 CRASH DETECTED (from DOM):", crash.reason);

        sendToContentScript("crash_detected", {
          type: "crash",
          ...crash,
          detectionMethod: "dom_based",
          recentConsoleErrors: localErrors.console.slice(-30),
          recentPageErrors: localErrors.page.slice(-20),
          recentApiErrors: localErrors.api.slice(-30),
          recentApiRequests: localErrors.apiRequests.slice(-50),
          timestamp: new Date().toISOString(),
          url: location.href,
          sessionDuration: Date.now() - START_TIME,
        });
      }
    }
  }

  function setupCrashMonitor() {
    if (!document.body) return;

    setTimeout(checkForDOMCrash, 500);
    setTimeout(checkForDOMCrash, 2000);
    setTimeout(checkForDOMCrash, 5000);

    new MutationObserver(() => {
      clearTimeout(window.__l2CrashTimeout);
      window.__l2CrashTimeout = setTimeout(checkForDOMCrash, 100);
    }).observe(document.body, { childList: true, subtree: true });
  }

  // Init crash monitor
  if (document.body) {
    setupCrashMonitor();
  } else {
    document.addEventListener("DOMContentLoaded", setupCrashMonitor);
  }

  _log("🔵 L2 Agent: Main world injection complete", {
    sessionId: SESSION_ID,
    interceptors: [
      "console.error",
      "console.warn",
      "window.error",
      "unhandledrejection",
      "XHR",
      "fetch",
    ],
    crashDetection: ["error_based", "dom_based"],
  });
})();
