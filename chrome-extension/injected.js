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
    apiRequests: [], // Sliding window: only keep APIs around errors
  };

  // API sliding window buffer - keeps last N requests until an error occurs
  const API_BUFFER_SIZE = 4; // Keep 3 before + current (will store 3 before failed API)
  const API_AFTER_ERROR_COUNT = 3; // Keep 3 after error
  let apiBuffer = []; // Temporary buffer before error
  let pendingAfterError = 0; // Count of requests to capture after error
  let lastErrorTimestamp = null;

  // Common trace ID headers to look for
  const TRACE_ID_HEADERS = [
    "x-trace-id",
    "x-request-id",
    "x-correlation-id",
    "traceparent",
    "x-amzn-trace-id",
    "x-b3-traceid",
    "request-id",
    "x-cloud-trace-context",
  ];

  // =============================================
  // ERROR FILTERING - Ignore noise, capture real errors
  // =============================================
  const IGNORED_ERROR_PATTERNS = [
    /^Unknown error$/i,
    /^undefined$/i,
    /^null$/i,
    /^Script error\.?$/i,
    /^ResizeObserver loop/i,
    /^ResizeObserver loop completed with undelivered notifications/i,
    /^\[object Object\]$/,
    /^\[object Event\]$/,
    /^Object$/,
    /^Error$/,
  ];

  const IGNORED_CONSOLE_PATTERNS = [
    /^\[HMR\]/i, // Hot Module Replacement noise
    /^%c/, // Styled console logs (usually debug)
    /^\[webpack/i,
    /^Download the React DevTools/i,
    /^Warning: ReactDOM.render is no longer supported/i,
    /^Warning: componentWillMount has been renamed/i,
    /^Warning: componentWillReceiveProps has been renamed/i,
    /^Warning: componentWillUpdate has been renamed/i,
  ];

  function shouldIgnoreError(message) {
    if (!message || typeof message !== "string") return true;

    const trimmed = message.trim();
    if (trimmed.length === 0) return true;
    if (trimmed.length < 3) return true; // Too short to be useful

    for (const pattern of IGNORED_ERROR_PATTERNS) {
      if (pattern.test(trimmed)) return true;
    }

    return false;
  }

  function shouldIgnoreConsoleError(message) {
    if (shouldIgnoreError(message)) return true;

    for (const pattern of IGNORED_CONSOLE_PATTERNS) {
      if (pattern.test(message)) return true;
    }

    return false;
  }

  function isRealError(errorType, message) {
    // Must have a meaningful error type
    const realErrorTypes = [
      "Error",
      "TypeError",
      "ReferenceError",
      "SyntaxError",
      "RangeError",
      "URIError",
      "EvalError",
      "AggregateError",
      "InternalError",
      "DOMException",
      "NetworkError",
      "AbortError",
      "ChunkLoadError",
    ];

    const hasRealType = realErrorTypes.some(
      (t) => errorType?.includes(t) || message?.includes(t)
    );

    // Must have meaningful message content
    const hasRealMessage =
      message && message.length > 5 && !shouldIgnoreError(message);

    return hasRealType || hasRealMessage;
  }

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
    const message = formatArgs(args);

    // Filter out noise - only capture real errors
    if (shouldIgnoreConsoleError(message)) {
      _error.apply(console, args);
      return;
    }

    // Check if this is a real error worth logging
    if (!isRealError(primaryError.type, message)) {
      _error.apply(console, args);
      return;
    }

    const entry = {
      type: "console.error",
      errorType: primaryError.type || "console.error",
      message,
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
      let errorInfo = { type: "Error", message: "", stack: "" };

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

      const message = errorInfo.message || e.message || "";

      // Filter out noise - only capture real errors
      if (shouldIgnoreError(message)) {
        return;
      }

      // Must have some useful info (filename, line number, or stack)
      const hasUsefulInfo =
        (e.filename && e.filename.length > 0) ||
        (e.lineno && e.lineno > 0) ||
        (errorInfo.stack && errorInfo.stack.length > 0);

      if (!hasUsefulInfo && !isRealError(errorInfo.type, message)) {
        return;
      }

      const entry = {
        type: "uncaught_error",
        errorType: errorInfo.type || "Error",
        message: message || "Uncaught error",
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
    const message = errorInfo.message || "";

    // Filter out noise
    if (shouldIgnoreError(message)) {
      return;
    }

    if (!isRealError(errorInfo.type, message)) {
      return;
    }

    const entry = {
      type: "unhandled_rejection",
      errorType: errorInfo.type || "PromiseRejection",
      message: message || "Promise rejected",
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
  // API STORAGE HELPER - Sliding window around errors
  // =============================================
  function extractTraceId(getHeader) {
    for (const header of TRACE_ID_HEADERS) {
      try {
        const value = getHeader(header);
        if (value) return { header, value };
      } catch {}
    }
    return null;
  }

  function storeApiRequest(entry) {
    if (entry.isError) {
      // Error occurred - flush buffer to storage
      // Add all buffered requests (these are the "before" requests)
      apiBuffer.forEach((bufferedEntry) => {
        localErrors.apiRequests.push(bufferedEntry);
        sendToContentScript("api_request", bufferedEntry);
      });
      apiBuffer = [];

      // Add the error itself
      localErrors.apiRequests.push(entry);
      sendToContentScript("api_request", entry);

      // Store as API error
      localErrors.api.push(entry);
      if (localErrors.api.length > 100) localErrors.api.shift();
      sendToContentScript("api_error", entry);

      // Set up to capture N more requests after error
      pendingAfterError = API_AFTER_ERROR_COUNT;
      lastErrorTimestamp = Date.now();

      _log(
        `🔴 L2 API Error: ${entry.method} ${entry.status} ${entry.url.slice(
          0,
          60
        )}`
      );
    } else if (pendingAfterError > 0) {
      // We're in "after error" mode - store this request
      localErrors.apiRequests.push(entry);
      sendToContentScript("api_request", entry);
      pendingAfterError--;

      _log(
        `🌐 L2 API (after error ${
          API_AFTER_ERROR_COUNT - pendingAfterError
        }/${API_AFTER_ERROR_COUNT}): ${entry.method} ${
          entry.status
        } ${entry.url.slice(0, 60)}`
      );
    } else {
      // Normal mode - add to buffer
      apiBuffer.push(entry);

      // Keep buffer at max size (sliding window)
      if (apiBuffer.length > API_BUFFER_SIZE) {
        apiBuffer.shift();
      }

      _log(
        `🌐 L2 API (buffered ${apiBuffer.length}/${API_BUFFER_SIZE}): ${
          entry.method
        } ${entry.status} ${entry.url.slice(0, 60)}`
      );
    }

    // Trim storage
    if (localErrors.apiRequests.length > 100) localErrors.apiRequests.shift();
  }

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
      req.body = body ? String(body).slice(0, 10000) : null; // Increased from 2000 to 10000

      xhr.addEventListener("loadend", function () {
        let responseBody = "";
        let responseHeaders = {};

        try {
          responseBody = xhr.responseText?.slice(0, 10000) || ""; // Increased from 5000 to 10000
        } catch {}

        // Extract all response headers
        try {
          const headerStr = xhr.getAllResponseHeaders();
          headerStr.split("\r\n").forEach((line) => {
            const [key, ...valueParts] = line.split(": ");
            if (key) responseHeaders[key.toLowerCase()] = valueParts.join(": ");
          });
        } catch {}

        // Extract trace ID
        const traceInfo = extractTraceId(
          (h) => responseHeaders[h.toLowerCase()]
        );

        const entry = {
          type: "xhr",
          method: req.method,
          url: req.url,
          status: xhr.status,
          statusText: xhr.statusText,
          duration: Date.now() - req.start,
          // Request details
          requestHeaders: req.headers,
          requestBody: req.body,
          // Response details
          responseHeaders,
          responseBody,
          traceId: traceInfo?.value || null,
          traceIdHeader: traceInfo?.header || null,
          isError: xhr.status === 0 || xhr.status >= 400,
          timestamp: new Date().toISOString(),
        };

        if (entry.isError) {
          let errorDetails = null;
          try {
            if (responseBody) errorDetails = JSON.parse(responseBody);
          } catch {}
          entry.errorDetails = errorDetails;
        }

        storeApiRequest(entry);
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

        storeApiRequest(entry);
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

        storeApiRequest(entry);
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
    let requestHeaders = {};

    try {
      if (init.body) {
        requestBody =
          typeof init.body === "string"
            ? init.body.slice(0, 10000) // Increased from 2000
            : "[Binary/FormData]";
      }
    } catch {}

    // Extract request headers
    try {
      if (init.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => {
            requestHeaders[key] = value;
          });
        } else if (typeof init.headers === "object") {
          requestHeaders = { ...init.headers };
        }
      }
    } catch {}

    try {
      const response = await _fetch(input, init);
      const duration = Date.now() - start;

      let responseBody = "";
      let responseHeaders = {};

      try {
        const clone = response.clone();
        responseBody = (await clone.text()).slice(0, 10000); // Increased from 5000
      } catch {}

      // Extract response headers
      try {
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
      } catch {}

      // Extract trace ID from response headers
      const traceInfo = extractTraceId((h) => response.headers.get(h));

      const entry = {
        type: "fetch",
        method,
        url,
        status: response.status,
        statusText: response.statusText,
        duration,
        // Request details
        requestHeaders,
        requestBody,
        // Response details
        responseHeaders,
        responseBody,
        traceId: traceInfo?.value || null,
        traceIdHeader: traceInfo?.header || null,
        isError: !response.ok,
        timestamp: new Date().toISOString(),
      };

      if (!response.ok) {
        let errorDetails = null;
        try {
          if (responseBody) errorDetails = JSON.parse(responseBody);
        } catch {}
        entry.errorDetails = errorDetails;
      }

      storeApiRequest(entry);
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
        // Request details
        requestHeaders,
        requestBody,
        isError: true,
        timestamp: new Date().toISOString(),
      };

      storeApiRequest(entry);
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
