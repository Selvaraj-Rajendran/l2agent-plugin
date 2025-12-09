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

    // Check if this is error analysis from L2 Agent
    const isErrorAnalysis =
      context?.source === "l2-agent-extension" && action === "analyze";

    if (isOpenAIFormat) {
      // Create a specialized prompt for error analysis
      let promptContent;

      if (isErrorAnalysis) {
        promptContent = this.buildErrorAnalysisPrompt(data);
      } else {
        promptContent = typeof data === "string" ? data : JSON.stringify(data);
      }

      // OpenAI format expects messages array
      payload = {
        model: this.model,
        messages: [
          {
            role: "system",
            content: isErrorAnalysis
              ? "You are an expert software engineer specializing in debugging web applications. Analyze errors and provide structured insights."
              : "You are a helpful assistant.",
          },
          {
            role: "user",
            content: promptContent,
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

    const result = await this.makeRequest(payload);

    // If this was error analysis, try to parse and structure the response
    if (isErrorAnalysis && isOpenAIFormat) {
      return this.structureErrorAnalysisResponse(result);
    }

    return result;
  }

  /**
   * Build a specialized prompt for error analysis
   * @param {String} data - JSON string of error data
   * @returns {String} - Formatted prompt
   */
  buildErrorAnalysisPrompt(data) {
    return `Analyze the following web application errors and provide a structured analysis:

${data}

Please provide your analysis in the following JSON format:
{
  "tags": {
    "errorType": "FE" | "BE" | "BOTH",
    "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
    "category": "API" | "UI" | "NETWORK" | "LOGIC" | "OTHER"
  },
  "rootCause": {
    "summary": "Brief description of the root cause",
    "details": "Detailed explanation of what went wrong and why"
  },
  "affectedComponents": ["list of affected components or systems"],
  "recommendations": [
    "Specific actionable recommendation 1",
    "Specific actionable recommendation 2"
  ],
  "additionalContext": "Any other relevant insights"
}

Guidelines:
- errorType: "FE" for frontend-only issues, "BE" for backend/API issues, "BOTH" when both are involved
- severity: Based on impact (CRITICAL: app crashes/data loss, HIGH: major features broken, MEDIUM: some features affected, LOW: minor issues)
- category: Primary error category
- Focus on actionable insights and specific recommendations
- Include relevant error codes, status codes, or stack traces in your analysis`;
  }

  /**
   * Structure the LLM response for error analysis
   * @param {Object} rawResponse - Raw response from LLM
   * @returns {Object} - Structured response
   */
  structureErrorAnalysisResponse(rawResponse) {
    try {
      // Extract content from OpenAI response format
      let content = rawResponse;

      if (rawResponse.choices && rawResponse.choices[0]) {
        content =
          rawResponse.choices[0].message?.content ||
          rawResponse.choices[0].text;
      }

      // Try to parse JSON from the content
      if (typeof content === "string") {
        // Look for JSON in code blocks or raw text
        const jsonMatch =
          content.match(/```json\n([\s\S]*?)\n```/) ||
          content.match(/```\n([\s\S]*?)\n```/) ||
          content.match(/^\s*\{[\s\S]*\}\s*$/);

        if (jsonMatch) {
          try {
            const jsonStr = jsonMatch[1] || jsonMatch[0];
            const parsed = JSON.parse(jsonStr);
            return {
              success: true,
              analysis: parsed,
              rawResponse: content,
            };
          } catch (e) {
            // JSON parse failed, continue to markdown parsing
            console.log(
              "JSON parsing failed, trying markdown extraction:",
              e.message
            );
          }
        }

        // If no JSON found or parsing failed, try to extract structured data from markdown
        const markdownAnalysis = this.parseMarkdownAnalysis(content);
        if (markdownAnalysis) {
          return {
            success: true,
            analysis: markdownAnalysis,
            rawResponse: content,
          };
        }
      }

      // If we can't parse anything, return as-is with fallback structure
      return {
        success: true,
        analysis: {
          tags: {
            errorType: "UNKNOWN",
            severity: "UNKNOWN",
            category: "OTHER",
          },
          rootCause: {
            summary: "See full analysis below",
            details:
              typeof content === "string" ? content : JSON.stringify(content),
          },
          recommendations: [],
          additionalContext: "LLM returned unstructured response",
        },
        rawResponse: content,
      };
    } catch (error) {
      console.error("Error structuring LLM response:", error);
      return {
        success: false,
        error: "Failed to structure response",
        rawResponse: rawResponse,
      };
    }
  }

  /**
   * Parse markdown-formatted analysis into structured format
   * @param {String} markdown - Markdown content from LLM
   * @returns {Object|null} - Structured analysis or null if parsing fails
   */
  parseMarkdownAnalysis(markdown) {
    try {
      const analysis = {
        tags: {},
        rootCause: {},
        affectedComponents: [],
        recommendations: [],
        additionalContext: "",
      };

      // Extract severity
      const severityMatch =
        markdown.match(/\*\*Severity:\*\*\s*🔴\s*\*\*(\w+)\*\*/i) ||
        markdown.match(/Severity:\s*(\w+)/i) ||
        markdown.match(/🔴\s*\*\*(\w+)\*\*/);
      if (severityMatch) {
        analysis.tags.severity = severityMatch[1].toUpperCase();
      } else if (markdown.includes("🔴") || markdown.match(/critical/i)) {
        analysis.tags.severity = "CRITICAL";
      } else if (markdown.match(/high/i)) {
        analysis.tags.severity = "HIGH";
      } else if (markdown.match(/medium/i)) {
        analysis.tags.severity = "MEDIUM";
      } else {
        analysis.tags.severity = "LOW";
      }

      // Determine error type based on content
      if (markdown.match(/frontend|FE|client-side|component|react|render/i)) {
        analysis.tags.errorType = "FE";
      } else if (
        markdown.match(/backend|BE|server|api|database|500\s+error/i)
      ) {
        analysis.tags.errorType = "BE";
      } else if (markdown.match(/both|full-stack/i)) {
        analysis.tags.errorType = "BOTH";
      } else {
        // Default to FE if we see component/render issues
        analysis.tags.errorType = markdown.match(/component|render|import/i)
          ? "FE"
          : "UNKNOWN";
      }

      // Determine category
      if (markdown.match(/api|endpoint|request|response/i)) {
        analysis.tags.category = "API";
      } else if (markdown.match(/network|connection|timeout/i)) {
        analysis.tags.category = "NETWORK";
      } else if (markdown.match(/ui|component|render/i)) {
        analysis.tags.category = "UI";
      } else {
        analysis.tags.category = "LOGIC";
      }

      // Extract root cause summary (look for problem summary or root cause section)
      const summaryMatch =
        markdown.match(/##\s*Problem Summary\s*\n\s*\*\*([^*]+)\*\*/i) ||
        markdown.match(/##\s*Root Cause[^#]*?\n\s*([^\n]+)/i) ||
        markdown.match(/\*\*Root Cause:\*\*\s*([^\n]+)/i) ||
        markdown.match(
          /##\s*🔴\s*Critical Issue Detected[^#]*?###\s*\*\*([^*]+)\*\*/i
        );

      if (summaryMatch) {
        analysis.rootCause.summary = summaryMatch[1].trim();
      } else {
        // Fallback: use first sentence after "Problem" or "Issue"
        const fallbackMatch = markdown.match(
          /(?:Problem|Issue)[:\s]+([^.]+\.)/i
        );
        analysis.rootCause.summary = fallbackMatch
          ? fallbackMatch[1].trim()
          : "See details below";
      }

      // Extract detailed explanation (look for root cause analysis or technical details section)
      const detailsMatch =
        markdown.match(/##\s*Root Cause Analysis\s*([\s\S]*?)(?=##|$)/i) ||
        markdown.match(/##\s*Technical Details\s*([\s\S]*?)(?=##|$)/i) ||
        markdown.match(/The error occurs[^.]+\.(?:[^.]+\.){0,3}/i);

      if (detailsMatch) {
        analysis.rootCause.details = detailsMatch[1]
          ? detailsMatch[1].trim().substring(0, 500)
          : detailsMatch[0].trim();
      } else {
        // Extract first few paragraphs as details
        const paragraphs = markdown
          .split("\n\n")
          .filter((p) => p.trim() && !p.startsWith("#"));
        analysis.rootCause.details = paragraphs
          .slice(0, 2)
          .join("\n\n")
          .substring(0, 500);
      }

      // Extract affected components
      const componentsMatch =
        markdown.match(/\*\*Affected Location[^:]*:\*\*\s*([^\n]+)/i) ||
        markdown.match(/\*\*Source File[^:]*:\*\*\s*([^\n]+)/i);
      if (componentsMatch) {
        analysis.affectedComponents.push(componentsMatch[1].trim());
      }

      // Look for component names
      const componentNames = markdown.match(
        /`(\w+Component|\w+Service|\w+Module)`/g
      );
      if (componentNames) {
        componentNames.forEach((comp) => {
          const cleanName = comp.replace(/`/g, "");
          if (!analysis.affectedComponents.includes(cleanName)) {
            analysis.affectedComponents.push(cleanName);
          }
        });
      }

      // Extract recommendations
      const recommendationsSection =
        markdown.match(/##\s*Recommended Fixes?\s*([\s\S]*?)(?=##|$)/i) ||
        markdown.match(/##\s*Steps to Resolve\s*([\s\S]*?)(?=##|$)/i) ||
        markdown.match(/##\s*Resolution\s*([\s\S]*?)(?=##|$)/i);

      if (recommendationsSection) {
        const recText = recommendationsSection[1];
        // Extract numbered or bulleted items
        const recItems = recText.match(
          /(?:^\d+\.|^-|\*)\s*\*\*([^*]+)\*\*|(?:^\d+\.|^-|\*)\s*([^\n]+)/gm
        );
        if (recItems) {
          recItems.forEach((item) => {
            const cleaned = item
              .replace(/^[\d\.\-\*\s]+/, "")
              .replace(/\*\*/g, "")
              .trim();
            if (cleaned.length > 10 && analysis.recommendations.length < 5) {
              analysis.recommendations.push(cleaned.substring(0, 150));
            }
          });
        }
      }

      // If no recommendations found, look for Priority sections
      if (analysis.recommendations.length === 0) {
        const priorities = markdown.match(
          /###\s*Priority\s*\d+[:\s]+([^\n]+)/gi
        );
        if (priorities) {
          priorities.forEach((p) => {
            const rec = p.replace(/###\s*Priority\s*\d+[:\s]+/i, "").trim();
            if (rec.length > 10) {
              analysis.recommendations.push(rec.substring(0, 150));
            }
          });
        }
      }

      // Extract additional context
      const contextMatch =
        markdown.match(/##\s*Additional Context\s*([\s\S]*?)(?=##|$)/i) ||
        markdown.match(/##\s*Prevention Recommendations\s*([\s\S]*?)(?=##|$)/i);
      if (contextMatch) {
        analysis.additionalContext = contextMatch[1].trim().substring(0, 300);
      }

      // Validate we got something useful
      if (analysis.rootCause.summary || analysis.recommendations.length > 0) {
        return analysis;
      }

      return null;
    } catch (error) {
      console.error("Error parsing markdown analysis:", error);
      return null;
    }
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
