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

module.exports = router;
