const axios = require("axios");
const config = require("../config/config");

class LLMService {
  constructor() {
    this.apiUrl = config.llm.apiUrl;
    this.apiKey = config.llm.apiKey;
    this.model = config.llm.model || "default";
    this.timeout = config.llm.timeout || 30000;
  }

  /**
   * Make a request to the LLM API
   * @param {Object} payload - The request payload
   * @returns {Promise<Object>} - The LLM response
   */
  async makeRequest(payload) {
    try {
      console.log("LLM Request Payload:", JSON.stringify(payload, null, 2));
      const response = await axios.post(this.apiUrl, payload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...config.llm.headers,
        },
        timeout: this.timeout,
      });

      console.log("LLM Response:", JSON.stringify(response.data, null, 2));

      // Check if response contains an error
      if (response.data && response.data.error) {
        throw new Error(response.data.error);
      }

      return response.data;
    } catch (error) {
      console.error("LLM API Error:", error.response?.data || error.message);
      console.error("Error details:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
      });
      throw new Error(`LLM request failed: ${error.message}`);
    }
  }

  /**
   * Process a general request with LLM
   * @param {Object} params - Request parameters
   * @param {*} params.data - Data to process
   * @param {Object} params.context - Additional context
   * @param {String} params.action - Action to perform
   * @returns {Promise<Object>} - Processed result
   */
  async processRequest({ data, context, action }) {
    // For OpenAI-compatible APIs, we need to format the request differently
    // Check if this is OpenAI format (has messages structure expected)
    const isOpenAIFormat =
      this.apiUrl.includes("openai.com") ||
      this.apiUrl.includes("chat/completions");

    let payload;

    if (isOpenAIFormat) {
      // OpenAI format expects messages array
      payload = {
        model: this.model,
        messages: [
          {
            role: "user",
            content: typeof data === "string" ? data : JSON.stringify(data),
          },
        ],
        ...config.llm.defaultParams,
      };
    } else {
      // Generic format
      payload = {
        model: this.model,
        data,
        context: context || {},
        action: action || "analyze",
        ...config.llm.defaultParams,
      };
    }

    return await this.makeRequest(payload);
  }

  /**
   * Analyze page content
   * @param {Object} params - Content parameters
   * @param {String} params.url - Page URL
   * @param {String} params.title - Page title
   * @param {String} params.content - Page content
   * @param {Object} params.metadata - Additional metadata
   * @returns {Promise<Object>} - Analysis result
   */
  async analyzeContent({ url, title, content, metadata }) {
    const payload = {
      model: this.model,
      task: "analyze",
      input: {
        url,
        title,
        content,
        metadata,
      },
      ...config.llm.defaultParams,
    };

    return await this.makeRequest(payload);
  }

  /**
   * Chat with LLM
   * @param {Object} params - Chat parameters
   * @param {String} params.message - User message
   * @param {Array} params.history - Conversation history
   * @returns {Promise<Object>} - Chat response
   */
  async chat({ message, history }) {
    const payload = {
      model: this.model,
      messages: [
        ...(history || []),
        {
          role: "user",
          content: message,
        },
      ],
      ...config.llm.defaultParams,
    };

    return await this.makeRequest(payload);
  }

  /**
   * Dynamic analysis - analyze any data with custom prompt
   * @param {Object} params - Analysis parameters
   * @param {Object|Array|String} params.data - Any data to analyze (JSON, text, etc.)
   * @param {String} params.prompt - Custom user prompt/question
   * @param {String} params.systemPrompt - Custom system prompt (optional)
   * @param {Object} params.context - Additional context
   * @returns {Promise<Object>} - Analysis result
   */
  async analyzeDynamic({ data, prompt, systemPrompt, context }) {
    const defaultSystemPrompt = `You are an expert analyst. Analyze the provided data and respond to the user's request. 
Be concise, accurate, and provide actionable insights.
Format your response with clear sections using markdown headers.`;

    // Format the data for the LLM
    let formattedData;
    if (typeof data === "string") {
      formattedData = data;
    } else {
      formattedData = JSON.stringify(data, null, 2);
    }

    const userMessage = prompt
      ? `${prompt}\n\n**Data:**\n\`\`\`json\n${formattedData}\n\`\`\``
      : `Please analyze this data:\n\`\`\`json\n${formattedData}\n\`\`\``;

    const payload = {
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt || defaultSystemPrompt },
        { role: "user", content: userMessage },
      ],
      ...config.llm.defaultParams,
    };

    return await this.makeRequest(payload);
  }

  /**
   * Analyze errors captured from browser for root cause analysis
   * @param {Object} params - Error data from Chrome extension
   * @param {Array} params.crashes - Crash events
   * @param {Array} params.apiErrors - API/Network errors
   * @param {Array} params.consoleErrors - Console errors
   * @param {Array} params.pageErrors - Page/JS errors
   * @param {Object} params.context - Additional context (URL, etc.)
   * @param {String} params.customPrompt - Custom prompt to override default (optional)
   * @param {String} params.customSystemPrompt - Custom system prompt (optional)
   * @returns {Promise<Object>} - Analysis result
   */
  async analyzeErrors({
    crashes,
    apiErrors,
    consoleErrors,
    pageErrors,
    context,
    customPrompt,
    customSystemPrompt,
  }) {
    // Build a focused error summary for the LLM
    const errorSummary = this.buildErrorSummary({
      crashes,
      apiErrors,
      consoleErrors,
      pageErrors,
    });

    const defaultSystemPrompt = `You are an expert web application debugger and error analyst. Your task is to analyze browser errors, console logs, and network failures to identify the root cause of issues.

When analyzing errors:
1. Look for patterns and correlations between different error types
2. Identify the most likely root cause
3. Consider the sequence of events (timeline)
4. Look for API failures that might cause UI/JS errors
5. Check for common issues: missing data, auth failures, network issues, JS exceptions

Provide your analysis in a structured format with:
- A brief summary of what went wrong
- The most likely root cause
- Supporting evidence from the logs
- Suggested fixes or next steps to investigate`;

    // Use custom prompts if provided
    const systemPrompt = customSystemPrompt || defaultSystemPrompt;

    // If custom prompt is provided, use it with the error data
    if (customPrompt) {
      const errorData = {
        crashes,
        apiErrors,
        consoleErrors,
        pageErrors,
        context,
      };
      const userMessage = `${customPrompt}\n\n**Error Data:**\n\`\`\`json\n${JSON.stringify(
        errorData,
        null,
        2
      )}\n\`\`\``;

      const payload = {
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        ...config.llm.defaultParams,
      };

      return await this.makeRequest(payload);
    }

    const userMessage = `Please analyze these browser errors and help identify the root cause of the issue.

**Page Context:**
- URL: ${context?.url || "Unknown"}
- Time: ${context?.timestamp || new Date().toISOString()}

**Error Summary:**
${errorSummary}

**Detailed Errors:**

${
  crashes?.length
    ? `### Crashes (${crashes.length})
${crashes
  .slice(0, 5)
  .map(
    (c) => `- ${c.timestamp}: ${c.reason || "Crash"} on ${c.pageUrl || c.url}
  Console errors before crash: ${c.recentConsoleErrors?.length || 0}
  API errors before crash: ${c.recentApiErrors?.length || 0}
  ${
    c.recentPageErrors?.length
      ? `  Key error: ${c.recentPageErrors[0]?.message?.slice(0, 200)}`
      : ""
  }`
  )
  .join("\n")}`
    : "No crashes detected."
}

${
  apiErrors?.length
    ? `### API Errors (${apiErrors.length})
${apiErrors
  .slice(0, 10)
  .map(
    (e) =>
      `- ${e.method || "GET"} ${e.url?.slice(0, 80)} → ${e.status} ${
        e.statusText || ""
      }
  Error: ${e.error || e.errorDetails?.message || "N/A"}
  Response: ${e.responseBody?.slice(0, 200) || "N/A"}`
  )
  .join("\n")}`
    : "No API errors."
}

${
  pageErrors?.length
    ? `### JavaScript Errors (${pageErrors.length})
${pageErrors
  .slice(0, 10)
  .map(
    (e) =>
      `- ${e.errorType || e.type}: ${e.message?.slice(0, 200)}
  File: ${e.filename || "N/A"}:${e.lineno || 0}:${e.colno || 0}
  Stack: ${e.stack?.split("\n").slice(0, 3).join(" → ") || "N/A"}`
  )
  .join("\n")}`
    : "No page errors."
}

${
  consoleErrors?.length
    ? `### Console Errors (${consoleErrors.length})
${consoleErrors
  .slice(0, 10)
  .map(
    (e) =>
      `- ${e.errorType || e.type}: ${e.message?.slice(0, 200)}
  ${e.stack?.split("\n")[0] || ""}`
  )
  .join("\n")}`
    : "No console errors."
}

Please provide your analysis of what went wrong and how to fix it.`;

    const payload = {
      model: this.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      ...config.llm.defaultParams,
    };

    return await this.makeRequest(payload);
  }

  /**
   * Build a concise error summary for LLM analysis
   */
  buildErrorSummary({ crashes, apiErrors, consoleErrors, pageErrors }) {
    const summary = [];

    if (crashes?.length) {
      summary.push(`🔴 ${crashes.length} crash(es) detected`);
    }
    if (apiErrors?.length) {
      const statusCounts = {};
      apiErrors.forEach((e) => {
        const status = e.status || "unknown";
        statusCounts[status] = (statusCounts[status] || 0) + 1;
      });
      summary.push(
        `🌐 ${apiErrors.length} API error(s): ${Object.entries(statusCounts)
          .map(([s, c]) => `${c}x ${s}`)
          .join(", ")}`
      );
    }
    if (pageErrors?.length) {
      const types = [...new Set(pageErrors.map((e) => e.errorType || e.type))];
      summary.push(`⚠️ ${pageErrors.length} JS error(s): ${types.join(", ")}`);
    }
    if (consoleErrors?.length) {
      summary.push(`📋 ${consoleErrors.length} console error(s)`);
    }

    return summary.length ? summary.join("\n") : "No errors found.";
  }

  /**
   * Check LLM connectivity
   * @returns {Promise<Object>} - Connection status
   */
  async checkConnection() {
    if (!this.apiUrl) {
      return {
        connected: false,
        error: "LLM API URL not configured",
        configured: false,
      };
    }

    if (!this.apiKey || this.apiKey.trim() === "") {
      return {
        connected: false,
        error:
          "LLM API key not configured. Please set LLM_API_KEY in your .env file",
        configured: false,
        url: this.apiUrl,
      };
    }

    try {
      // Try a simple health check or minimal request
      // Adjust this based on your LLM provider's health check endpoint
      const testPayload = {
        model: this.model,
        messages: [
          {
            role: "user",
            content: "test",
          },
        ],
        ...config.llm.defaultParams,
      };

      const startTime = Date.now();
      const response = await axios.post(this.apiUrl, testPayload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...config.llm.headers,
        },
        timeout: 5000, // Shorter timeout for health check
      });

      const responseTime = Date.now() - startTime;

      return {
        connected: true,
        responseTime: `${responseTime}ms`,
        status: response.status,
        url: this.apiUrl,
        configured: true,
      };
    } catch (error) {
      let errorMessage = error.message;
      let errorDetails = null;

      // Provide more helpful error messages
      if (error.response?.status === 401) {
        errorMessage = "Authentication failed - Invalid or missing API key";
        errorDetails = {
          hint: "Check that LLM_API_KEY is set correctly in your .env file",
          statusCode: 401,
        };
      } else if (error.response?.status === 404) {
        errorMessage = "LLM API endpoint not found";
        errorDetails = {
          hint: "Check that LLM_API_URL is correct",
          statusCode: 404,
        };
      } else if (error.code === "ECONNREFUSED") {
        errorMessage = "Cannot connect to LLM API server";
        errorDetails = {
          hint: "Check that the LLM server is running and LLM_API_URL is correct",
        };
      } else if (error.code === "ETIMEDOUT") {
        errorMessage = "Connection timeout - LLM server not responding";
        errorDetails = {
          hint: "Check network connectivity and LLM_API_URL",
        };
      }

      return {
        connected: false,
        error: errorMessage,
        statusCode: error.response?.status,
        url: this.apiUrl,
        configured: true,
        details: errorDetails,
        rawError: error.response?.data || error.message,
      };
    }
  }
}

module.exports = new LLMService();
