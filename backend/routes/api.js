const express = require("express");
const router = express.Router();
const llmService = require("../services/llm");

// Test endpoint - doesn't require LLM
router.post("/test", async (req, res) => {
  try {
    const { data, context, action } = req.body;

    res.json({
      success: true,
      message: "Endpoint is working correctly!",
      received: {
        data: data || null,
        context: context || null,
        action: action || null,
      },
      timestamp: new Date().toISOString(),
      info: "This is a test endpoint that doesn't call the LLM. Use /process, /analyze, or /chat for actual LLM processing.",
    });
  } catch (error) {
    res.status(500).json({
      error: "Test endpoint error",
      message: error.message,
    });
  }
});

// Endpoint to receive data from Chrome extension and process with LLM
router.post("/process", async (req, res) => {
  try {
    const { data, context, action } = req.body;

    if (!data) {
      return res.status(400).json({
        error: "Missing required field: data",
      });
    }

    // Process the data with LLM
    const result = await llmService.processRequest({
      data,
      context: context || {},
      action: action || "analyze",
    });

    res.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Error processing request:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      error: "Failed to process request",
      message: error.message,
      details: error.response?.data || error.toString(),
    });
  }
});

// Endpoint to send page content for analysis
router.post("/analyze", async (req, res) => {
  try {
    const { url, title, content, metadata } = req.body;

    if (!content) {
      return res.status(400).json({
        error: "Missing required field: content",
      });
    }

    const result = await llmService.analyzeContent({
      url,
      title,
      content,
      metadata: metadata || {},
    });

    res.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Error analyzing content:", error);
    res.status(500).json({
      error: "Failed to analyze content",
      message: error.message,
    });
  }
});

// Endpoint for general LLM interaction
router.post("/chat", async (req, res) => {
  try {
    const { message, history } = req.body;

    if (!message) {
      return res.status(400).json({
        error: "Missing required field: message",
      });
    }

    const result = await llmService.chat({
      message,
      history: history || [],
    });

    res.json({
      success: true,
      result,
    });
  } catch (error) {
    console.error("Error in chat:", error);
    res.status(500).json({
      error: "Failed to process chat message",
      message: error.message,
    });
  }
});

// Endpoint to analyze errors from Chrome extension and get root cause from LLM
// Supports custom prompts for dynamic analysis
router.post("/analyze-errors", async (req, res) => {
  try {
    const { 
      crashes, 
      apiErrors, 
      consoleErrors, 
      pageErrors, 
      context,
      prompt,           // Custom user prompt (optional)
      systemPrompt      // Custom system prompt (optional)
    } = req.body;

    // Validate that we have some error data to analyze
    const hasErrors =
      (crashes && crashes.length > 0) ||
      (apiErrors && apiErrors.length > 0) ||
      (consoleErrors && consoleErrors.length > 0) ||
      (pageErrors && pageErrors.length > 0);

    if (!hasErrors) {
      return res.status(400).json({
        error: "No error data provided",
        message: "Please provide at least one type of error data to analyze",
      });
    }

    console.log("Analyzing errors:", {
      crashes: crashes?.length || 0,
      apiErrors: apiErrors?.length || 0,
      consoleErrors: consoleErrors?.length || 0,
      pageErrors: pageErrors?.length || 0,
      url: context?.url,
      customPrompt: !!prompt,
    });

    // Analyze errors with LLM (supports custom prompts)
    const result = await llmService.analyzeErrors({
      crashes: crashes || [],
      apiErrors: apiErrors || [],
      consoleErrors: consoleErrors || [],
      pageErrors: pageErrors || [],
      context: context || {},
      customPrompt: prompt,
      customSystemPrompt: systemPrompt,
    });

    // Extract the analysis text from the response
    let analysis = "";
    if (result.choices && result.choices[0]?.message?.content) {
      // OpenAI format
      analysis = result.choices[0].message.content;
    } else if (result.content) {
      // Generic format
      analysis = result.content;
    } else if (typeof result === "string") {
      analysis = result;
    } else {
      analysis = JSON.stringify(result);
    }

    res.json({
      success: true,
      analysis,
      summary: {
        crashesAnalyzed: crashes?.length || 0,
        apiErrorsAnalyzed: apiErrors?.length || 0,
        consoleErrorsAnalyzed: consoleErrors?.length || 0,
        pageErrorsAnalyzed: pageErrors?.length || 0,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error analyzing errors:", error);
    console.error("Error stack:", error.stack);
    res.status(500).json({
      error: "Failed to analyze errors",
      message: error.message,
      details: error.response?.data || error.toString(),
    });
  }
});

// Dynamic analysis endpoint - analyze ANY data with custom prompt
router.post("/analyze-dynamic", async (req, res) => {
  try {
    const { data, prompt, systemPrompt, context } = req.body;

    if (!data && !prompt) {
      return res.status(400).json({
        error: "Missing required fields",
        message: "Please provide 'data' and/or 'prompt'",
      });
    }

    console.log("Dynamic analysis request:", {
      hasData: !!data,
      dataType: typeof data,
      hasPrompt: !!prompt,
      hasSystemPrompt: !!systemPrompt,
    });

    // Analyze with LLM
    const result = await llmService.analyzeDynamic({
      data,
      prompt,
      systemPrompt,
      context: context || {},
    });

    // Extract the analysis text from the response
    let analysis = "";
    if (result.choices && result.choices[0]?.message?.content) {
      analysis = result.choices[0].message.content;
    } else if (result.content) {
      analysis = result.content;
    } else if (typeof result === "string") {
      analysis = result;
    } else {
      analysis = JSON.stringify(result);
    }

    res.json({
      success: true,
      analysis,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error in dynamic analysis:", error);
    res.status(500).json({
      error: "Failed to analyze data",
      message: error.message,
      details: error.response?.data || error.toString(),
    });
  }
});

module.exports = router;
