// API Service for fetching logs with traceId
// This service calls the backend API to fetch logs when a valid XHR API fails

/**
 * Gets the base URL from the current page (domain where API failed)
 * @param {string} failedApiUrl - The URL of the failed API call
 * @returns {string} Base URL (protocol + hostname + port)
 */
function getBaseUrlFromFailedApi(failedApiUrl) {
  try {
    const url = new URL(failedApiUrl);
    return `${url.protocol}//${url.host}`;
  } catch (e) {
    // Fallback to current page origin if URL parsing fails
    return window.location ? window.location.origin : "http://localhost:3000";
  }
}

/**
 * Fetches logs from the backend API using traceId
 * @param {string} traceId - The trace ID from the API error
 * @param {string} startTime - ISO timestamp for search start
 * @param {string} endTime - ISO timestamp for search end
 * @param {string} baseUrl - Base URL of the domain where API failed
 * @returns {Promise<Object>} API response with logs
 */
async function fetchLogsWithTraceId(traceId, startTime, endTime, baseUrl) {
  try {
    // Use the hardcoded secret from config (not session cookies)
    const secret = CONFIG.LOG_SEARCH_SECRET;

    const payload = {
      query: traceId,
      startTime,
      endTime,
      secret,
    };

    // Build API URL: <domain>/api/v2/logs/search
    const apiUrl = `${baseUrl}${CONFIG.API_LOG_SEARCH_PATH}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `API call failed: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    return { success: true, data };
  } catch (error) {
    console.error("L2 API Error:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Checks if an API error is a valid XHR failure that should trigger log fetching
 * @param {Object} errorData - The API error data object
 * @returns {boolean} True if this is a valid XHR API failure
 */
function isValidXhrApiFailure(errorData) {
  // Must be an API error or resource error
  const errorType = errorData?.errorType || errorData?.type || "";
  if (errorType !== "api_error" && errorType !== "resource_error") {
    return false;
  }

  // Must have a URL
  const url = errorData?.url || "";
  if (!url) {
    return false;
  }

  // Exclude Sentry API failures
  if (url.includes("sentry.io") || url.includes("sentry")) {
    return false;
  }

  // Must be a failed XHR/fetch request (4xx or 5xx status)
  const status = errorData?.status || 0;
  if (status < 400) {
    return false;
  }

  // Must be an actual API call (not a static resource)
  // Check if URL looks like an API endpoint
  const isApiEndpoint =
    url.includes("/api/") ||
    url.includes("/v1/") ||
    url.includes("/v2/") ||
    url.includes("/graphql") ||
    url.includes("/rest/") ||
    (errorData.method &&
      ["POST", "PUT", "PATCH", "DELETE"].includes(
        errorData.method.toUpperCase()
      ));

  if (!isApiEndpoint) {
    return false;
  }

  return true;
}

/**
 * Checks if an error is related to Sentry API failures
 * @param {Object} errorData - The error data object
 * @returns {boolean} True if this is a Sentry API failure
 */
function isSentryApiFailure(errorData) {
  const url = errorData?.url || "";
  const message = errorData?.message || "";
  const stack = errorData?.stack || "";

  // Check if the error is related to Sentry
  return (
    url.includes("sentry.io") ||
    url.includes("sentry") ||
    message.includes("sentry") ||
    stack.includes("sentry")
  );
}

/**
 * Extracts traceId from error data
 * @param {Object} errorData - The error data object
 * @returns {string|null} The traceId if found, null otherwise
 */
function extractTraceId(errorData) {
  // Try to find traceId in various possible locations
  if (errorData.traceId) {
    return errorData.traceId;
  }

  if (errorData.trace_id) {
    return errorData.trace_id;
  }

  if (errorData.metadata?.traceId) {
    return errorData.metadata.traceId;
  }

  if (errorData.context?.traceId) {
    return errorData.context.traceId;
  }

  // Try to find in response headers
  if (errorData.headers) {
    const headers = errorData.headers;
    if (headers["x-trace-id"]) {
      return headers["x-trace-id"];
    }
    if (headers["X-Trace-Id"]) {
      return headers["X-Trace-Id"];
    }
    if (headers["traceid"]) {
      return headers["traceid"];
    }
  }

  // Try to extract from response body
  if (errorData.response) {
    const response =
      typeof errorData.response === "string"
        ? errorData.response
        : JSON.stringify(errorData.response);

    const traceIdMatch = response.match(
      /(?:trace[_-]?id|traceId)[":\s]+["']?([a-f0-9-]+)["']?/i
    );
    if (traceIdMatch) {
      return traceIdMatch[1];
    }
  }

  // Try to extract from message or stack trace
  const text = `${errorData.message || ""} ${errorData.stack || ""} ${
    errorData.error || ""
  }`;
  const traceIdMatch = text.match(/trace[_-]?id[:\s]+([a-f0-9-]+)/i);
  if (traceIdMatch) {
    return traceIdMatch[1];
  }

  return null;
}

/**
 * Handles API error and calls backend API to fetch logs if appropriate
 * Only calls API for valid XHR failures with traceId
 * @param {Object} errorData - The API error data object
 * @returns {Promise<Object|null>} API response if called, null otherwise
 */
async function handleApiErrorLogFetch(errorData) {
  // Only proceed if this is a valid XHR API failure
  if (!isValidXhrApiFailure(errorData)) {
    return null;
  }

  // Extract traceId
  const traceId = extractTraceId(errorData);
  if (!traceId) {
    return null;
  }

  // Get base URL from the failed API's domain
  const baseUrl = getBaseUrlFromFailedApi(errorData.url);

  // Calculate time window
  const errorTime = new Date(errorData.timestamp);
  const startTime = new Date(
    errorTime.getTime() - CONFIG.LOG_SEARCH_WINDOW.BEFORE_CRASH
  ).toISOString();
  const endTime = new Date(
    errorTime.getTime() + CONFIG.LOG_SEARCH_WINDOW.AFTER_CRASH
  ).toISOString();

  // Call API with base URL from failed API's domain
  const result = await fetchLogsWithTraceId(
    traceId,
    startTime,
    endTime,
    baseUrl
  );

  // Attach the API response to the error data for later reference
  if (result.success && errorData) {
    errorData.apiLogs = result.data;
    errorData.apiLogsFetched = true;
    errorData.apiLogsFetchedAt = new Date().toISOString();
    errorData.apiLogsUrl = `${baseUrl}${CONFIG.API_LOG_SEARCH_PATH}`;
  }

  return result;
}

/**
 * Handles crash with failed APIs - fetches logs for API failures that caused the crash
 * Only calls API if crash has failed APIs with traceId (indicating API-related crash)
 * If crash has no API failures, it's likely a UI/frontend issue - no API call needed
 * @param {Object} crashData - The crash data object with recentApiErrors
 * @returns {Promise<Object|null>} API response if called, null otherwise
 */
async function handleCrashWithFailedApis(crashData) {
  // Check if crash has recent API errors
  if (
    !crashData ||
    !crashData.recentApiErrors ||
    crashData.recentApiErrors.length === 0
  ) {
    // No API failures - this is likely a UI/frontend crash
    // Don't call API, just return null (will be collected in report as-is)
    return null;
  }

  // Find the most recent valid API failure with traceId
  const failedApis = crashData.recentApiErrors.filter((apiError) => {
    return isValidXhrApiFailure(apiError) && extractTraceId(apiError);
  });

  if (failedApis.length === 0) {
    // No valid API failures with traceId found
    return null;
  }

  // Process the most recent failed API (closest to crash time)
  const mostRecentFailedApi = failedApis[failedApis.length - 1];

  // Fetch logs for this API failure
  const result = await handleApiErrorLogFetch(mostRecentFailedApi);

  // Also attach the result to the crash data for reference
  if (result && result.success && crashData) {
    crashData.crashCausedByApi = true;
    crashData.apiCauseUrl = mostRecentFailedApi.url;
    crashData.apiCauseStatus = mostRecentFailedApi.status;
    crashData.apiCauseTraceId = extractTraceId(mostRecentFailedApi);
  }

  return result;
}

/**
 * Legacy function for crash handling (kept for backward compatibility)
 * @deprecated Use handleCrashWithFailedApis instead
 */
async function handleCrashApiCall(crashData) {
  return await handleCrashWithFailedApis(crashData);
}
