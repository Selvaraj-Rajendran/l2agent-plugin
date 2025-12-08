# L2 Agent

A monorepo containing a Chrome extension and Node.js backend server for LLM-powered web page analysis.

## Structure

```
l2agent/
├── chrome-extension/          # Chrome plugin
│   ├── manifest.json          # Extension configuration
│   ├── popup.html             # Popup UI
│   ├── popup.js               # Popup logic
│   ├── background.js          # Background service worker
│   ├── content.js             # Content script (runs on web pages)
│   ├── options.html           # Options/settings page
│   ├── options.js             # Options page logic
│   ├── styles.css             # Shared styles
│   └── icons/                 # Extension icons
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── backend/                   # Node Express server
│   ├── package.json           # Node dependencies
│   ├── server.js              # Main Express server
│   ├── routes/
│   │   └── api.js             # API routes for Chrome extension
│   ├── services/
│   │   └── llm.js             # LLM service integration
│   ├── config/
│   │   └── config.js          # Configuration management
│   └── .env.example           # Environment variables template
└── README.md                  # This file
```

## Setup

### Backend Server

1. **Navigate to backend directory**

   ```bash
   cd backend
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` and configure:

   - `LLM_API_URL`: URL of your private internal LLM provider API
   - `LLM_API_KEY`: API key for LLM provider (if required)
   - `PORT`: Server port (default: 3000)
   - `ALLOWED_ORIGINS`: Comma-separated list of allowed origins for CORS

4. **Start the server**

   ```bash
   npm start
   ```

   The server will run on `http://localhost:3000` by default.

### Chrome Extension

1. **Enable Developer Mode**

   - Open Chrome and navigate to `chrome://extensions/`
   - Toggle **"Developer mode"** switch ON (top-right corner)

2. **Load the Extension**

   - Click **"Load unpacked"** button
   - Select the `chrome-extension/` folder

3. **Configure Backend URL**

   - Right-click the extension icon → **Options**
   - Enter your backend server URL (e.g., `http://localhost:3000`)
   - Click **Save Settings**

4. **Reload After Changes**
   - Make changes to your code
   - Go to `chrome://extensions/`
   - Click the refresh icon (🔄) on the extension card to reload

## Features

### Chrome Extension

- **Popup**: Click the extension icon to open the popup and analyze the current page
- **Content Script**: Automatically runs on all web pages to extract content
- **Background Service Worker**: Handles communication with backend API
- **Options Page**: Configure backend URL and other settings
- **Storage**: Uses Chrome's sync storage API for settings

### Backend Server

- **REST API**: Endpoints for Chrome extension to send data
- **LLM Integration**: Configurable service for connecting to private internal LLM provider
- **CORS Support**: Configured to accept requests from Chrome extension
- **Error Handling**: Comprehensive error handling and logging

## API Endpoints

### `POST /api/process`

Process data with LLM

```json
{
  "data": "data to process",
  "context": {},
  "action": "analyze"
}
```

### `POST /api/analyze`

Analyze page content

```json
{
  "url": "https://example.com",
  "title": "Page Title",
  "content": "Page content text",
  "metadata": {}
}
```

### `POST /api/chat`

Chat with LLM

```json
{
  "message": "User message",
  "history": []
}
```

### `GET /health`

Health check endpoint

## Permissions

Chrome extension permissions:

- `activeTab`: Access to the currently active tab
- `storage`: Store extension settings
- `host_permissions`: Access to all HTTP/HTTPS sites (for content scripts)

## Configuration

### Backend Configuration

Edit `backend/.env` to configure:

- LLM provider API URL and credentials
- Server port
- CORS allowed origins

### Chrome Extension Configuration

Configure via Options page:

- Backend server URL
- Extension enabled/disabled state
- Custom settings

## Development

### Backend Development

```bash
cd backend
npm install
npm start
```

### Chrome Extension Development

1. Make changes to files in `chrome-extension/`
2. Reload extension in `chrome://extensions/`
3. Test functionality

## Resources

- [Chrome Extension Documentation](https://developer.chrome.com/docs/extensions/)
- [Manifest V3 Migration Guide](https://developer.chrome.com/docs/extensions/mv3/intro/)
- [Express.js Documentation](https://expressjs.com/)
- [Node.js Documentation](https://nodejs.org/docs/)
