// Extension Configuration
// This file contains configuration values for the L2 Agent extension

const CONFIG = {
  // API endpoint path for log search
  API_LOG_SEARCH_PATH: "/api/v2/logs/search",

  // Authentication secret for log search API (from .env file)
  // This is loaded from backend/.env LOG_SEARCH_SECRET
  LOG_SEARCH_SECRET:
    "userEmail=syed.smith@freshworks.com; HAYSAuthSessionID-0=Par8P3Sl16txM1qCftApXb+O7C5aPkoF1wtbb59PD7tgBxpX9imZxoYObVXPd4dkd2uK5xUR0cZdmxjisi7WZFMQ4xpnss+5WsyHaYb2btvkh5mrZhJAiK1agckK+xIxr+mUg5MYPTO7ixOYBJpmdU7WcD43RUKOXT9rNVo9jGjX8y2qP8ovCSX8LaldMUtVy1OynOxAxBQJ9DcaVKaOdFmDuTXnXh2DJaole9oxjomgXlBo1O2Wg6Ml/zoRxURTCdmtrncJ/7cMttiWdQIbqJuOBKu0UpSYuunkMFQ+Lbvj9jB2V1zRFSi4agR0QuPRM3puHJg90mDKdjGNo48LD1nNvUqzsNP5IQdi7b7PB9iiUWDfSVlWAY85LSxfGY0IHiuctHBoYZUxhMwPBFl4msoswXUb0B/zqHoZnnLMQcMotQKNytC1CHBj/HzaPldkGl9cD4E87L2HBkZaD93D96qS9lIfDXHyV9l9Kqiis/Q2JmPgyPU/l9CPgVkdNkHCy1TmvEjEJnscNFmlXErO7jnYf5EdHmMEusYYtoqnBNhRH4TUjR68Urtjni2AgeexJ5o2meW6hg2c5lvCPJgdJYzJIbS3GDB+PowdJqkfGgw7mYqtB1kE8VqHFGVodrkmIhMj+acUNUOBEfBkr7ud3EKvAz7t1Q2zZfdAOyp4POik/thEsxzjWu1RFsHprZyDoV9i+3nrgCqPwTqOZWnL10gXISbowAHb9eHOAicKa/xkcUZrd0c/kjNJaw0rtmpP8aXGkjMkr2hUxnEgouutWHp7qasP7mx7FjG1M9u1K8SdJQ4coqJclMDVa/anh2YR4FqHO2h0V1Op8tbUIZeJkmjcghgaIvJUblmCvOwNs5Gum53YheIccRIZpJ65u0BAEsUGga94JqGG4GL4l7K+4BvuSNW/2SID2FPLdUoZZRWcHs0qXf5cP6tGqRtwAYgY+CbjwKvcDIC4/UUXRlLtQfPwIHN8/HtjiN2UiPJH4WqSAnKl36LVhpvG9eYwZebnmP6jxBjE6r+0YzNv7lezp1SI7dniH76SqxzOsFKoHoTHWtFSTROgFkjx5olq5f2XTLbDUQ/SPBVD0mJL7++K8DjedvaIF23dC8xrbBXp0xXOnFjjVXtTvPZZZif06ix6zqqmEjelU74lb45e9q8G9EpCgafjPf4yAEATHHbrssLwz0C2eVwMKqixKgYkgEYa7IrvzB2rC/PnuCRnc4L+ZFnWyBaEOGeaoybsk9Rxjd9Y7g=",

  // Time window for log search (in milliseconds)
  LOG_SEARCH_WINDOW: {
    BEFORE_CRASH: 5 * 60 * 1000, // 5 minutes before crash
    AFTER_CRASH: 1 * 60 * 1000, // 1 minute after crash
  },

  // API call settings
  API_TIMEOUT: 10000, // 10 seconds

  // When to call API for crash logs
  CALL_API_ON: {
    CRASH_DETECTED: true, // Call when crash has failed APIs
    API_ERROR: true, // Call on valid XHR API failures
    PAGE_ERROR: false,
    CONSOLE_ERROR: false,
  },
};
