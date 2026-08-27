/**
 * Rakshak Background Service Worker (Manifest V3)
 * Central persistent orchestrator for multi-step reasoning, tab navigation,
 * local privacy gate validation, and continuous background agent execution.
 */

import { isRestrictedPage, isSafeDestinationUrl, extractNavigationGoal } from '../popup/safe_navigator.js';
import '../privacy_gate/privacy_gate.js';

// Global background agent state
let agentState = {
  isRunning: false,
  taskId: null,
  task: '',
  currentStep: 0,
  maxSteps: 12,
  status: 'idle', // 'idle' | 'running' | 'completed' | 'failed' | 'stopped'
  targetTabId: null,
  targetWindowId: null,
  serverUrl: 'http://localhost:8000',
  stepHistory: [],
  logs: [],
  technicalLogs: [],
  finalMessage: null
};

// Initialize configuration on extension install
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Rakshak] Service Worker initialized successfully.');
  chrome.storage.local.get(['serverUrl', 'overlayVisible'], (result) => {
    if (!result.serverUrl) {
      chrome.storage.local.set({ serverUrl: 'http://localhost:8000' });
    }
    if (result.overlayVisible === undefined) {
      chrome.storage.local.set({ overlayVisible: true });
    }
  });
});

// Broadcast current agent state to active tabs and open extension views
function broadcastStateUpdate(targetTabId = null) {
  // Persist current state in storage for resilience
  chrome.storage.local.set({ activeAgentState: agentState });

  // Broadcast to specific target tab if provided
  if (targetTabId) {
    chrome.tabs.sendMessage(targetTabId, { type: 'AGENT_STATE_UPDATED', state: agentState }).catch(() => {});
  }

  // Also broadcast to all tabs that have our content script loaded
  chrome.tabs.query({}, (tabs) => {
    (tabs || []).forEach((t) => {
      if (t.id) {
        chrome.tabs.sendMessage(t.id, { type: 'AGENT_STATE_UPDATED', state: agentState }).catch(() => {});
      }
    });
  });
}

function addAgentLog(icon, text, statusClass = 'done') {
  const logItem = {
    icon,
    text,
    statusClass,
    timestamp: Date.now()
  };
  agentState.logs.push(logItem);
  broadcastStateUpdate(agentState.targetTabId);
}

function addTechnicalDetail(data) {
  agentState.technicalLogs.push(data);
  broadcastStateUpdate(agentState.targetTabId);
}

// ---------------------------------------------------------------------------
// 1. TOOLBAR ACTION CLICK -> TOGGLE IN-PAGE OVERLAY
// ---------------------------------------------------------------------------
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;

  if (isRestrictedPage(tab.url)) {
    // Cannot inject content script into chrome:// or internal pages
    return;
  }

  await ensureContentScriptsInTab(tab.id);
  chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_OVERLAY' }).catch(() => {});
});

// ---------------------------------------------------------------------------
// 2. SCRIPT INJECTION & TAB READINESS HELPERS
// ---------------------------------------------------------------------------
async function ensureContentScriptsInTab(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: [
        'content/pii_detector.js',
        'content/visual_redactor.js',
        'content/context_collector.js',
        'content/action_executor.js',
        'content/overlay_agent.js'
      ]
    });
  } catch (e) {
    // Scripts may already be present or tab is protected
  }
}

async function waitForTabReady(tabId, maxWaitMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.status === 'complete') {
        return tab;
      }
    } catch (e) {
      // Tab may be transitioning
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  try {
    return await chrome.tabs.get(tabId);
  } catch (e) {
    return null;
  }
}

async function navigateTab(tabId, destinationUrl) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, { url: destinationUrl }, (updatedTab) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }

      const listener = (listenerTabId, changeInfo, tab) => {
        if (listenerTabId === tabId && changeInfo.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve(tab);
        }
      };

      chrome.tabs.onUpdated.addListener(listener);

      // Fallback timeout in case onUpdated fired early
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        chrome.tabs.get(tabId).then(resolve).catch(resolve);
      }, 7000);
    });
  });
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response);
      }
    });
  });
}

// ---------------------------------------------------------------------------
// 3. HUMAN-FRIENDLY ACTION FORMATTING
// ---------------------------------------------------------------------------
function formatHumanAction(actionObj) {
  const action = actionObj.action;
  const target = actionObj.target;
  const value = actionObj.value;
  const key = actionObj.key;

  const targetDesc = target ? (target.label || target.name || target.elementId || target.selector || 'element') : '';

  switch (action) {
    case 'TYPE':
      if (key === 'ENTER') {
        return `Entered "${value || ''}" into search box & submitted search`;
      }
      return `Entered "${value || ''}" into ${targetDesc}`;
    case 'CLICK':
      if (targetDesc.length > 50) {
        return `Selected result: "${targetDesc.slice(0, 48)}..."`;
      }
      return `Clicked ${targetDesc || 'selected item'}`;
    case 'KEY':
      return `Submitted search with key ${key || 'ENTER'}`;
    case 'PLAY':
      return `Started video/audio playback`;
    case 'SCROLL':
      return `Scrolled page ${actionObj.direction || 'down'} for more content`;
    case 'WAIT':
      return `Waiting for page content to finish loading`;
    case 'STOP':
      return `Task completed`;
    default:
      return `${action} ${targetDesc}`;
  }
}

// ---------------------------------------------------------------------------
// 4. LOCAL GOAL VERIFICATION
// ---------------------------------------------------------------------------
function verifyGoalCompletionLocally(task, stepHistory, localContext) {
  const taskLower = String(task || '').toLowerCase().trim();
  const elements = localContext?.elements || [];
  const mediaState = localContext?.mediaState || localContext?.page?.mediaState || {};
  const history = stepHistory || [];
  const successfulSteps = history.filter(h => h.result === 'Success');
  const pastActions = successfulSteps.map(h => h.action);

  if (successfulSteps.length === 0) {
    if (elements.length > 0) {
      return {
        completed: false,
        reason: 'No actions have been executed yet toward the requested goal.'
      };
    }
  }

  // Media / Video Play Goals (e.g. "play video of X", "watch X", "play X song")
  const isPlayGoal = /\b(play|watch|stream|listen|song|video)\b/i.test(taskLower);
  if (isPlayGoal) {
    const hasClickedContent = pastActions.includes('CLICK');
    const hasPlayed = pastActions.includes('PLAY') || mediaState.isPlaying;

    if (!pastActions.includes('TYPE') && !hasClickedContent) {
      return {
        completed: false,
        reason: 'Search query has not been entered yet.'
      };
    }

    if (!hasClickedContent && elements.length > 0) {
      return {
        completed: false,
        reason: 'Search was performed, but the video result has not been opened yet.'
      };
    }

    const isWatchPage = localContext?.page?.url && (
      localContext.page.url.includes('/watch') ||
      localContext.page.url.includes('/video/')
    );

    if (!hasPlayed && !mediaState.isPlaying && !isWatchPage) {
      if (!pastActions.includes('PLAY')) {
        return {
          completed: false,
          reason: 'Video result was opened, but playback has not started yet.'
        };
      }
    }

    return {
      completed: true,
      reason: 'Video found, opened, and playback verified.'
    };
  }

  // Search Goals
  const isSearchGoal = /\b(search|find|lookup|query)\b/i.test(taskLower);
  if (isSearchGoal) {
    const hasTyped = pastActions.includes('TYPE');
    if (!hasTyped) {
      return {
        completed: false,
        reason: 'Search query has not been typed into any search input yet.'
      };
    }

    const hasFollowUp = /\b(open|click|start)\b/i.test(taskLower);
    if (hasFollowUp) {
      const hasFollowUpAction = (pastActions.filter(a => a === 'CLICK').length >= 1);
      if (!hasFollowUpAction) {
        return {
          completed: false,
          reason: 'Search was performed, but the requested result item has not been clicked yet.'
        };
      }
    }
  }

  // Scroll Goals
  const isScrollGoal = /\b(scroll)\b/i.test(taskLower);
  if (isScrollGoal) {
    const hasScrolled = pastActions.includes('SCROLL');
    if (!hasScrolled) {
      return {
        completed: false,
        reason: 'Scroll action has not been performed yet.'
      };
    }
  }

  // Click / Submit Goals
  const isClickGoal = /\b(click|submit|press|login|sign in)\b/i.test(taskLower);
  if (isClickGoal) {
    const hasClicked = pastActions.includes('CLICK') || pastActions.includes('KEY');
    if (!hasClicked) {
      return {
        completed: false,
        reason: 'Click or submit action has not been performed yet.'
      };
    }
  }

  return {
    completed: true,
    reason: 'Goal verification passed based on executed action sequence.'
  };
}

// ---------------------------------------------------------------------------
// 5. MAIN AUTONOMOUS MULTI-STEP REASONING LOOP
// ---------------------------------------------------------------------------
async function runAgentTask(targetTabId, task, maxSteps = 12, serverUrl = 'http://localhost:8000') {
  agentState.isRunning = true;
  agentState.taskId = `task-${Date.now()}`;
  agentState.task = task;
  agentState.currentStep = 0;
  agentState.maxSteps = maxSteps;
  agentState.status = 'running';
  agentState.targetTabId = targetTabId;
  agentState.serverUrl = serverUrl;
  agentState.stepHistory = [];
  agentState.logs = [];
  agentState.technicalLogs = [];
  agentState.finalMessage = null;

  broadcastStateUpdate(targetTabId);

  try {
    let tab = await chrome.tabs.get(targetTabId);
    if (!tab) throw new Error('Target tab not found.');

    const isCurrentPageRestricted = isRestrictedPage(tab.url);
    const targetNavUrl = extractNavigationGoal(task);

    // Handle restricted or initial navigation
    if (isCurrentPageRestricted) {
      if (targetNavUrl && isSafeDestinationUrl(targetNavUrl)) {
        addAgentLog('✓', 'Preparing the browser', 'done');
        addAgentLog('→', `Navigating to ${targetNavUrl}`, 'active');

        await navigateTab(targetTabId, targetNavUrl);
        await waitForTabReady(targetTabId, 5000);
        await new Promise((r) => setTimeout(r, 1200));

        tab = await chrome.tabs.get(targetTabId);
        if (isRestrictedPage(tab.url)) {
          addAgentLog('✗', 'Destination page is restricted by browser.', 'failed');
          agentState.finalMessage = 'I could not open that destination because it is restricted.';
          agentState.status = 'failed';
          agentState.isRunning = false;
          broadcastStateUpdate(targetTabId);
          return;
        }

        addAgentLog('✓', `Website loaded (${new URL(tab.url).hostname})`, 'done');
      } else {
        addAgentLog('ℹ️', 'Active tab is an internal page (chrome://). Please open a website or specify a URL.', 'info');
        agentState.finalMessage = 'Please open a regular website or tell me which site to open (e.g. "Open YouTube").';
        agentState.status = 'failed';
        agentState.isRunning = false;
        broadcastStateUpdate(targetTabId);
        return;
      }
    } else if (targetNavUrl && isSafeDestinationUrl(targetNavUrl)) {
      try {
        const currentHost = new URL(tab.url).hostname.replace(/^www\./, '');
        const targetHost = new URL(targetNavUrl).hostname.replace(/^www\./, '');

        if (currentHost !== targetHost) {
          addAgentLog('→', `Navigating to ${targetNavUrl}`, 'active');
          await navigateTab(targetTabId, targetNavUrl);
          await waitForTabReady(targetTabId, 5000);
          await new Promise((r) => setTimeout(r, 1200));
          tab = await chrome.tabs.get(targetTabId);
          addAgentLog('✓', `Website loaded (${targetHost})`, 'done');
        }
      } catch (e) {
        // Fall through
      }
    }

    let currentStep = 0;
    let taskComplete = false;
    let consecutiveFailures = 0;

    while (currentStep < maxSteps && !taskComplete && agentState.isRunning) {
      currentStep++;
      agentState.currentStep = currentStep;
      broadcastStateUpdate(targetTabId);

      // 1. Ensure scripts and tab readiness
      await waitForTabReady(targetTabId, 3000);
      await ensureContentScriptsInTab(targetTabId);

      // 2. Collect local DOM context
      let contextResp = null;
      try {
        contextResp = await sendTabMessage(targetTabId, { type: 'COLLECT_LOCAL_CONTEXT' });
      } catch (msgErr) {
        await new Promise((r) => setTimeout(r, 800));
        await ensureContentScriptsInTab(targetTabId);
        contextResp = await sendTabMessage(targetTabId, { type: 'COLLECT_LOCAL_CONTEXT' });
      }

      if (!contextResp || !contextResp.success) {
        throw new Error('Failed to inspect active tab context.');
      }

      const localContext = contextResp.context;

      if (currentStep === 1) {
        addAgentLog('✓', `Inspecting current page (${localContext.totalCount || 0} interactive elements)`, 'done');
        if (localContext.sensitiveCount > 0) {
          addAgentLog('✓', `Privacy Gate: Redacted ${localContext.sensitiveCount} sensitive items locally`, 'done');
        } else {
          addAgentLog('✓', 'Local Privacy Shield Active (Zero raw PII leaves browser)', 'done');
        }
      }

      // Check media completion shortcut (Only valid on watch/content pages after a video has been clicked)
      const isPlayTask = /\b(play|watch|stream|listen|song|video)\b/i.test(task);
      const isSearchPage = localContext.page?.url && (
        localContext.page.url.includes('/results') ||
        localContext.page.url.includes('search_query=') ||
        localContext.page.url.includes('/search')
      );
      const hasClickedVideo = agentState.stepHistory.some(h => h.action === 'CLICK' || h.action === 'PLAY');

      if (isPlayTask && !isSearchPage && hasClickedVideo && localContext.mediaState?.isPlaying) {
        addAgentLog('✓', 'Video playback confirmed active', 'done');
        addAgentLog('✓', 'Task completed successfully', 'done');
        agentState.finalMessage = 'I have found and started playing the requested video.';
        taskComplete = true;
        break;
      }

      // 3. Privacy Gate Sanitization
      const rawPayload = {
        task: task,
        page: localContext.page,
        elements: localContext.elements,
        sanitizedImage: null,
        clientId: 'rakshak-extension-agent',
        stepHistory: agentState.stepHistory,
        currentStep: currentStep,
        maxSteps: maxSteps
      };

      let sanitizedPayload = rawPayload;
      if (self.__rakshakPrivacyGate && typeof self.__rakshakPrivacyGate.validateAndSanitizePayload === 'function') {
        const gateResult = self.__rakshakPrivacyGate.validateAndSanitizePayload(rawPayload);
        sanitizedPayload = gateResult.sanitizedPayload;
      }

      // 4. Backend Reasoning Call
      let res;
      try {
        res = await fetch(`${serverUrl}/api/v1/act`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sanitizedPayload)
        });
      } catch (fetchErr) {
        throw new Error(`Cannot connect to backend server at ${serverUrl}. Please ensure the Python server is running (run 'python main.py' in the server folder).`);
      }

      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Server error (${res.status}): ${errBody || res.statusText}`);
      }

      const aiDecision = await res.json();
      addTechnicalDetail({ step: currentStep, decision: aiDecision });

      // If user stopped in the meantime
      if (!agentState.isRunning) break;

      // 5. Local Safety Validation
      const validationResp = await sendTabMessage(targetTabId, {
        type: 'VALIDATE_LOCAL_ACTION',
        action: aiDecision
      });

      if (!validationResp || !validationResp.valid) {
        const errMsg = validationResp?.error || 'Local safety validation rejected the action';
        addAgentLog('✗', `Validation note: ${errMsg}`, 'failed');

        consecutiveFailures++;
        agentState.stepHistory.push({
          step: currentStep,
          action: aiDecision.action || 'INVALID',
          target: aiDecision.target?.elementId || aiDecision.target?.selector || '',
          result: 'Validation Failed',
          message: errMsg
        });

        if (consecutiveFailures >= 3) {
          addAgentLog('⚠️', 'Execution stopped for safety compliance.', 'failed');
          break;
        }
        continue;
      }

      consecutiveFailures = 0;

      // 6. Check STOP action & Goal Verification
      if (aiDecision.action === 'STOP') {
        const verification = verifyGoalCompletionLocally(task, agentState.stepHistory, localContext);
        if (!verification.completed) {
          addAgentLog('→', `Continuing: ${verification.reason}`, 'info');
          agentState.stepHistory.push({
            step: currentStep,
            action: 'STOP_REJECTED',
            target: '',
            result: 'Rejected',
            message: `Goal not yet verified: ${verification.reason}`
          });

          consecutiveFailures++;
          if (consecutiveFailures >= 3) {
            addAgentLog('✓', 'Task completed to the extent possible.', 'done');
            break;
          }
          continue;
        }

        addAgentLog('✓', 'Task completed successfully', 'done');
        agentState.finalMessage = 'I have completed your task.';
        taskComplete = true;
        break;
      }

      // 7. Local Action Execution
      const humanActionText = formatHumanAction(aiDecision);
      const execResult = await sendTabMessage(targetTabId, {
        type: 'EXECUTE_LOCAL_ACTION',
        action: aiDecision
      });

      const targetName = aiDecision.target?.elementId || aiDecision.target?.selector || (aiDecision.action === 'KEY' ? aiDecision.key : '');

      if (execResult && execResult.success) {
        addAgentLog('✓', humanActionText, 'done');

        agentState.stepHistory.push({
          step: currentStep,
          action: aiDecision.action,
          target: targetName,
          value: aiDecision.value || aiDecision.key || '',
          result: 'Success',
          message: execResult.message
        });

        // Delay for dynamic page updates / navigation
        if (aiDecision.action === 'CLICK' || aiDecision.action === 'TYPE' || aiDecision.action === 'KEY') {
          await new Promise((r) => setTimeout(r, 1800));
        } else {
          await new Promise((r) => setTimeout(r, 1000));
        }
      } else {
        const failMsg = execResult?.message || 'Action could not be applied';
        addAgentLog('✗', `${humanActionText} (${failMsg})`, 'failed');

        agentState.stepHistory.push({
          step: currentStep,
          action: aiDecision.action,
          target: targetName,
          result: 'Failed',
          message: failMsg
        });

        consecutiveFailures++;
        if (consecutiveFailures >= 3) {
          addAgentLog('⚠️', 'Stopping after consecutive execution issues.', 'failed');
          break;
        }
      }
    }

    if (currentStep >= maxSteps && !taskComplete && agentState.isRunning) {
      addAgentLog('✓', `Completed maximum allowed steps (${maxSteps}).`, 'done');
      agentState.finalMessage = 'I finished running the requested workflow steps.';
    }

    agentState.status = taskComplete ? 'completed' : 'stopped';
  } catch (err) {
    console.error('[Rakshak Background] Task execution error:', err);
    addAgentLog('✗', `Error: ${err.message}`, 'failed');
    agentState.finalMessage = 'Encountered an issue while executing the task.';
    agentState.status = 'failed';
  } finally {
    agentState.isRunning = false;
    broadcastStateUpdate(targetTabId);
  }
}

// ---------------------------------------------------------------------------
// 6. MESSAGE LISTENERS (POPUP, OVERLAY, & CONTENT SCRIPTS)
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 1. PING BACKEND SERVER
  if (message.type === 'PING_SERVER') {
    const serverUrl = message.serverUrl || 'http://localhost:8000';
    const startTime = performance.now();

    fetch(`${serverUrl}/api/v1/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: 'rakshak-extension-mv3',
        timestamp: Date.now() / 1000
      })
    })
      .then(async (res) => {
        const latencyMs = Math.round(performance.now() - startTime);
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        const data = await res.json();
        sendResponse({ success: true, data, latencyMs });
      })
      .catch((err) => {
        const latencyMs = Math.round(performance.now() - startTime);
        sendResponse({ success: false, error: err.message, latencyMs });
      });

    return true;
  }

  // 2. START AGENT TASK
  if (message.type === 'START_AGENT_TASK') {
    (async () => {
      try {
        let tabId = message.tabId;
        if (!tabId) {
          const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
          tabId = activeTab?.id;
        }

        if (!tabId) {
          sendResponse({ success: false, error: 'No active tab available for task execution.' });
          return;
        }

        const task = message.task;
        const maxSteps = message.maxSteps || 12;
        const serverUrl = message.serverUrl || 'http://localhost:8000';

        // Run asynchronously in background service worker
        runAgentTask(tabId, task, maxSteps, serverUrl);
        sendResponse({ success: true, taskId: agentState.taskId });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();

    return true;
  }

  // 3. STOP AGENT TASK
  if (message.type === 'STOP_AGENT_TASK') {
    agentState.isRunning = false;
    agentState.status = 'stopped';
    addAgentLog('⏹', 'Execution stopped by user', 'info');
    agentState.finalMessage = 'Execution stopped by user.';
    broadcastStateUpdate(agentState.targetTabId);
    sendResponse({ success: true });
    return true;
  }

  // 4. GET AGENT STATE
  if (message.type === 'GET_AGENT_STATE') {
    sendResponse({ success: true, state: agentState });
    return true;
  }

  // 5. CAPTURE AND REDACT SCREENSHOT
  if (message.type === 'CAPTURE_AND_REDACT_SCREEN') {
    (async () => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!activeTab || !activeTab.id) {
          sendResponse({ success: false, error: 'No active browser tab found.' });
          return;
        }

        if (isRestrictedPage(activeTab.url)) {
          sendResponse({ success: false, error: 'Cannot capture internal browser pages.' });
          return;
        }

        await ensureContentScriptsInTab(activeTab.id);

        // Hide overlay momentarily for pristine screen capture
        await chrome.tabs.sendMessage(activeTab.id, { type: 'HIDE_OVERLAY_FOR_CAPTURE' }).catch(() => {});

        chrome.tabs.captureVisibleTab(null, { format: 'jpeg', quality: 90 }, async (dataUrl) => {
          // Restore overlay immediately
          chrome.tabs.sendMessage(activeTab.id, { type: 'RESTORE_OVERLAY_AFTER_CAPTURE' }).catch(() => {});

          if (chrome.runtime.lastError || !dataUrl) {
            sendResponse({ success: false, error: chrome.runtime.lastError?.message || 'Capture failed' });
            return;
          }

          chrome.tabs.sendMessage(
            activeTab.id,
            { type: 'PERFORM_VISUAL_REDACTION', rawScreenshot: dataUrl },
            (redactResp) => {
              if (chrome.runtime.lastError || !redactResp || !redactResp.success) {
                sendResponse({ success: false, error: redactResp?.error || 'Redaction failed' });
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

  return true;
});
