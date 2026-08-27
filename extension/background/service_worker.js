// Service worker handling background tasks and communication with Rakshak server

chrome.runtime.onInstalled.addListener(() => {
  console.log('[Rakshak] Extension installed successfully.');
  chrome.storage.local.get(['serverUrl'], (result) => {
    if (!result.serverUrl) {
      chrome.storage.local.set({ serverUrl: 'http://localhost:8000' });
    }
  });
});

// Listener for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'PING_SERVER') {
    const serverUrl = message.serverUrl || 'http://localhost:8000';
    const startTime = performance.now();

    fetch(`${serverUrl}/api/v1/ping`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: 'rakshak-extension-mv3',
        timestamp: Date.now() / 1000
      })
    })
      .then(async (res) => {
        const latencyMs = Math.round(performance.now() - startTime);
        if (!res.ok) {
          throw new Error(`Server returned HTTP ${res.status}: ${res.statusText}`);
        }
        const data = await res.json();
        sendResponse({ success: true, data, latencyMs });
      })
      .catch((err) => {
        const latencyMs = Math.round(performance.now() - startTime);
        sendResponse({ success: false, error: err.message, latencyMs });
      });

    return true;
  }

  if (message.type === 'CAPTURE_AND_REDACT_SCREEN') {
    (async () => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab || !activeTab.id) {
          sendResponse({ success: false, error: 'No active browser tab found.' });
          return;
        }

        if (!activeTab.url || activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('edge://') || activeTab.url.startsWith('about:')) {
          sendResponse({ success: false, error: 'Cannot capture internal browser pages (chrome://). Please open a website or HTML page.' });
          return;
        }

        // Ensure scripts are loaded in tab
        try {
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ['content/pii_detector.js', 'content/visual_redactor.js', 'content/context_collector.js', 'content/action_executor.js']
          });
        } catch (injectErr) {
          console.warn('Script pre-injection note:', injectErr);
        }

        // Capture visible tab screenshot
        chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 90 }, (dataUrl) => {
          if (chrome.runtime.lastError || !dataUrl) {
            sendResponse({ success: false, error: chrome.runtime.lastError?.message || 'Screenshot capture failed' });
            return;
          }

          chrome.tabs.sendMessage(
            activeTab.id,
            { type: 'PERFORM_VISUAL_REDACTION', rawScreenshot: dataUrl },
            (redactResp) => {
              if (chrome.runtime.lastError || !redactResp || !redactResp.success) {
                sendResponse({ success: false, error: redactResp?.error || chrome.runtime.lastError?.message || 'Redaction failed in tab' });
              } else {
                sendResponse({
                  success: true,
                  sanitizedImage: redactResp.sanitizedImage,
                  redactedCount: redactResp.redactedCount
                });
              }
            }
          );
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  }

  if (message.type === 'SEND_REASONING_REQUEST') {
    (async () => {
      try {
        const serverUrl = message.serverUrl || 'http://localhost:8000';
        const rawPayload = message.payload;

        // Ensure Privacy Gate is loaded and applied
        let sanitizedPayload = rawPayload;
        let auditLog = null;

        if (typeof importScripts === 'function') {
          try {
            importScripts('/privacy_gate/privacy_gate.js');
          } catch (e) {
            // Fallback
          }
        }

        if (typeof self !== 'undefined' && self.__rakshakPrivacyGate && typeof self.__rakshakPrivacyGate.validateAndSanitizePayload === 'function') {
          const gateResult = self.__rakshakPrivacyGate.validateAndSanitizePayload(rawPayload);
          sanitizedPayload = gateResult.sanitizedPayload;
          auditLog = gateResult.auditLog;
        }

        // Minimal Dev Logging (Never logs actual sensitive values)
        const elementsCount = Array.isArray(sanitizedPayload.elements) ? sanitizedPayload.elements.length : 0;
        const sensitiveCount = Array.isArray(sanitizedPayload.elements) ? sanitizedPayload.elements.filter(e => e.isSensitive).length : 0;
        const payloadBytes = JSON.stringify(sanitizedPayload).length;
        console.log(`[Rakshak Privacy Gate] Outgoing Request Sanitized: YES | Payload Size: ${payloadBytes} bytes | Elements: ${elementsCount} | Sensitive Items Redacted: ${sensitiveCount}`);

        const response = await fetch(`${serverUrl}/api/v1/act`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(sanitizedPayload)
        });

        if (!response.ok) {
          throw new Error(`Server returned HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        sendResponse({ success: true, data, auditLog });
      } catch (err) {
        console.error('[Rakshak] Reasoning request error:', err);
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  }

  return true;
});
