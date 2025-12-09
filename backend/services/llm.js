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
