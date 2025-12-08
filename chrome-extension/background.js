// Background service worker (Manifest V3)
// This runs in the background and persists across page loads

// Default backend URL
const DEFAULT_BACKEND_URL = 'http://localhost:3000';

// Install event
chrome.runtime.onInstalled.addListener((details) => {
  console.log('Extension installed:', details.reason);
  
  if (details.reason === 'install') {
    // Set default settings
    chrome.storage.sync.set({
      settings: {
        enabled: true,
        version: '1.0.0',
        backendUrl: DEFAULT_BACKEND_URL
      }
    });
  }
});

// Helper function to get backend URL from settings
async function getBackendUrl() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(['settings'], (result) => {
      const backendUrl = result.settings?.backendUrl || DEFAULT_BACKEND_URL;
      resolve(backendUrl);
    });
  });
}

// Send data to backend API
async function sendToBackend(endpoint, data) {
  try {
    const backendUrl = await getBackendUrl();
    const url = `${backendUrl}/api/${endpoint}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    if (!response.ok) {
      throw new Error(`Backend request failed: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error sending to backend:', error);
    throw error;
  }
}

// Listen for messages from content scripts or popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('Background received message:', request);

  if (request.action === 'getData') {
    // Example: Fetch data or perform background task
    sendResponse({ success: true, data: 'Background data' });
  }

  if (request.action === 'sendToBackend') {
    // Forward data to backend API
    sendToBackend(request.endpoint, request.data)
      .then((result) => {
        sendResponse({ success: true, result });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }

  if (request.action === 'analyzePage') {
    // Analyze page content with backend
    sendToBackend('analyze', {
      url: request.url,
      title: request.title,
      content: request.content,
      metadata: request.metadata || {}
    })
      .then((result) => {
        sendResponse({ success: true, result });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true; // Keep channel open for async response
  }

  // Return true to indicate we will send a response asynchronously
  return true;
});

// Listen for tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    console.log('Tab updated:', tab.url);
  }
});

