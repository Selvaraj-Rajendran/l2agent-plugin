require('dotenv').config();

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: process.env.PORT || 3000,
  
  allowedOrigins: process.env.ALLOWED_ORIGINS 
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['*'],

  llm: {
    apiUrl: process.env.LLM_API_URL || 'http://localhost:8080/api/v1/chat',
    apiKey: process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'default',
    timeout: parseInt(process.env.LLM_TIMEOUT || '30000', 10),
    headers: process.env.LLM_HEADERS 
      ? JSON.parse(process.env.LLM_HEADERS)
      : {},
    defaultParams: process.env.LLM_DEFAULT_PARAMS
      ? JSON.parse(process.env.LLM_DEFAULT_PARAMS)
      : {}
  }
};

