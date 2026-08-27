import { isRestrictedPage, isSafeDestinationUrl, extractNavigationGoal } from './safe_navigator.js';

document.addEventListener('DOMContentLoaded', () => {
  // Elements - Header & Diagnostics
  const statusBadge = document.getElementById('statusBadge');
  const statusText = document.getElementById('statusText');
  const devToggleBtn = document.getElementById('devToggleBtn');
  const closeDrawerBtn = document.getElementById('closeDrawerBtn');
  const diagnosticsDrawer = document.getElementById('diagnosticsDrawer');
  const serverUrlInput = document.getElementById('serverUrlInput');
  const testConnBtn = document.getElementById('testConnBtn');
  const serverInfoCard = document.getElementById('serverInfoCard');
  const latencyVal = document.getElementById('latencyVal');
  const providerVal = document.getElementById('providerVal');
  const hfVal = document.getElementById('hfVal');
  const geminiVal = document.getElementById('geminiVal');

  // Elements - Tabs & Navigation
  const tabChatBtn = document.getElementById('tabChatBtn');
  const tabInspectBtn = document.getElementById('tabInspectBtn');
  const tabPrivacyBtn = document.getElementById('tabPrivacyBtn');
  const chatTab = document.getElementById('chatTab');
  const inspectTab = document.getElementById('inspectTab');
  const privacyTab = document.getElementById('privacyTab');

  // Elements - Chat Interface
  const chatMessages = document.getElementById('chatMessages');
  const chatInput = document.getElementById('chatInput');
  const chatSendBtn = document.getElementById('chatSendBtn');

  // Elements - Inspect Tab
  const collectContextBtn = document.getElementById('collectContextBtn');
  const inspectLoading = document.getElementById('inspectLoading');
  const inspectEmptyState = document.getElementById('inspectEmptyState');
  const contextResults = document.getElementById('contextResults');
  const pageTitleVal = document.getElementById('pageTitleVal');
  const elementsCountVal = document.getElementById('elementsCountVal');
  const sensitiveCountVal = document.getElementById('sensitiveCountVal');
  const elementsList = document.getElementById('elementsList');

  // Elements - Privacy Tab
  const redactPreviewBtn = document.getElementById('redactPreviewBtn');
  const privacyLoading = document.getElementById('privacyLoading');
  const privacyEmptyState = document.getElementById('privacyEmptyState');
  const redactionImageContainer = document.getElementById('redactionImageContainer');
  const sanitizedPreviewImg = document.getElementById('sanitizedPreviewImg');
  const redactedBadgesCount = document.getElementById('redactedBadgesCount');

  // State
  let latestSanitizedImage = null;
  let isAgentRunning = false;
  const DEFAULT_MAX_STEPS = 12;

  // -------------------------------------------------------------
  // 1. NAVIGATION & DRAWER
  // -------------------------------------------------------------
  function switchTab(targetTab) {
    [chatTab, inspectTab, privacyTab].forEach(t => t.style.display = 'none');
    [tabChatBtn, tabInspectBtn, tabPrivacyBtn].forEach(b => b.classList.remove('active'));

    if (targetTab === 'chat') {
      chatTab.style.display = 'flex';
      tabChatBtn.classList.add('active');
    } else if (targetTab === 'inspect') {
      inspectTab.style.display = 'flex';
      tabInspectBtn.classList.add('active');
    } else if (targetTab === 'privacy') {
      privacyTab.style.display = 'flex';
      tabPrivacyBtn.classList.add('active');
    }
  }

  tabChatBtn.addEventListener('click', () => switchTab('chat'));
  tabInspectBtn.addEventListener('click', () => switchTab('inspect'));
  tabPrivacyBtn.addEventListener('click', () => switchTab('privacy'));

  // Drawer Toggle (Hidden Technical Diagnostics)
  devToggleBtn.addEventListener('click', () => {
    diagnosticsDrawer.style.display = diagnosticsDrawer.style.display === 'none' ? 'flex' : 'none';
  });

  closeDrawerBtn.addEventListener('click', () => {
    diagnosticsDrawer.style.display = 'none';
  });

  // -------------------------------------------------------------
  // 2. SERVER CONNECTION & TELEMETRY
  // -------------------------------------------------------------
  chrome.storage.local.get(['serverUrl'], (result) => {
    const defaultUrl = result.serverUrl || 'http://localhost:8000';
    if (serverUrlInput) serverUrlInput.value = defaultUrl;
    testConnection(defaultUrl);
  });

  if (serverUrlInput) {
    serverUrlInput.addEventListener('change', () => {
      const url = serverUrlInput.value.trim().replace(/\/+$/, '');
      chrome.storage.local.set({ serverUrl: url });
    });
  }

  if (testConnBtn) {
    testConnBtn.addEventListener('click', () => {
      const url = serverUrlInput.value.trim().replace(/\/+$/, '');
      chrome.storage.local.set({ serverUrl: url });
      testConnection(url);
    });
  }

  function updateStatus(state, text) {
    statusBadge.className = `status-badge ${state}`;
    statusText.textContent = text;
  }

  function testConnection(url) {
    updateStatus('checking', 'Connecting');
    if (testConnBtn) testConnBtn.disabled = true;

    chrome.runtime.sendMessage(
      { type: 'PING_SERVER', serverUrl: url },
      (response) => {
        if (testConnBtn) testConnBtn.disabled = false;
        if (chrome.runtime.lastError) {
          updateStatus('disconnected', 'Offline');
          if (serverInfoCard) serverInfoCard.style.display = 'none';
          return;
        }

        if (response && response.success) {
          updateStatus('connected', 'Connected');
          if (serverInfoCard) {
            serverInfoCard.style.display = 'block';
            latencyVal.textContent = `${response.latencyMs} ms`;
            providerVal.textContent = response.data.configured_provider || 'auto';
            hfVal.textContent = response.data.hf_configured ? (response.data.hf_model || 'Configured') : 'Not Set';
            geminiVal.textContent = response.data.gemini_configured ? 'Configured' : 'Not Set';
          }
        } else {
          updateStatus('disconnected', 'Offline');
          if (serverInfoCard) serverInfoCard.style.display = 'none';
        }
      }
    );
  }

  // -------------------------------------------------------------
  // 3. INSPECT PAGE (DOM & Local Elements)
  // -------------------------------------------------------------
  collectContextBtn.addEventListener('click', async () => {
    await runDomInspection();
  });

  async function runDomInspection() {
    collectContextBtn.disabled = true;
    inspectLoading.style.display = 'flex';
    inspectEmptyState.style.display = 'none';
    contextResults.style.display = 'none';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) throw new Error('No active tab found.');

      if (isRestrictedPage(tab.url)) {
        inspectLoading.style.display = 'none';
        inspectEmptyState.style.display = 'flex';
        inspectEmptyState.innerHTML = `
          <div class="empty-icon">🛡️</div>
          <div>This page (<code>${escapeHtml(tab.url || 'internal page')}</code>) is protected by the browser. Please navigate to a standard website to inspect DOM elements.</div>
        `;
        collectContextBtn.disabled = false;
        return;
      }

      await ensureScriptsInTab(tab.id);

      chrome.tabs.sendMessage(tab.id, { type: 'COLLECT_LOCAL_CONTEXT' }, (response) => {
        collectContextBtn.disabled = false;
        inspectLoading.style.display = 'none';

        if (chrome.runtime.lastError || !response || !response.success) {
          inspectEmptyState.style.display = 'flex';
          inspectEmptyState.innerHTML = `
            <div class="empty-icon">⚠️</div>
            <div>Could not read page context: ${escapeHtml(chrome.runtime.lastError?.message || 'Empty response')}</div>
          `;
          return;
        }

        renderContext(response.context);
      });
    } catch (err) {
      collectContextBtn.disabled = false;
      inspectLoading.style.display = 'none';
      inspectEmptyState.style.display = 'flex';
      inspectEmptyState.innerHTML = `
        <div class="empty-icon">⚠️</div>
        <div>Error inspecting DOM: ${escapeHtml(err.message)}</div>
      `;
    }
  }

  function renderContext(context) {
    if (!context) return;
    inspectEmptyState.style.display = 'none';
    contextResults.style.display = 'block';
    pageTitleVal.textContent = context.page?.title || 'Untitled';
    elementsCountVal.textContent = context.totalCount || 0;
    sensitiveCountVal.textContent = `${context.sensitiveCount || 0} Detected`;

    elementsList.innerHTML = '';
    (context.elements || []).slice(0, 20).forEach((el) => {
      const item = document.createElement('div');
      const isSens = el.isSensitive;
      const borderCol = isSens ? '#f85149' : '#30363d';
      const badge = isSens ? `<span style="background: rgba(248, 81, 73, 0.2); color: #f85149; padding: 1px 4px; border-radius: 3px; font-size: 9px; margin-right: 4px;">🔒 ${el.sensitiveDetections?.[0]?.type || 'PII'}</span>` : '';

      item.style.cssText = `background: #161b22; padding: 4px 6px; border-radius: 4px; border: 1px solid ${borderCol}; display: flex; justify-content: space-between; align-items: center; font-size: 11px;`;
      item.innerHTML = `<div>${badge}<span style="color: #58a6ff; font-family: monospace;">[${el.tag}] ${el.label || el.name || el.type || 'unlabeled'}</span></div><span style="color: #8b949e; font-size: 10px;">(${el.boundingBox?.x || 0}, ${el.boundingBox?.y || 0})</span>`;
      elementsList.appendChild(item);
    });

    if ((context.elements || []).length > 20) {
      const more = document.createElement('div');
      more.style.cssText = 'color: #8b949e; text-align: center; margin-top: 4px; font-size: 10px;';
      more.textContent = `+ ${context.elements.length - 20} more elements (held in browser memory)`;
      elementsList.appendChild(more);
    }
  }

  // -------------------------------------------------------------
  // 4. PRIVACY & VISUAL REDACTION
  // -------------------------------------------------------------
  redactPreviewBtn.addEventListener('click', () => {
    runVisualRedaction();
  });

  async function runVisualRedaction() {
    redactPreviewBtn.disabled = true;
    privacyLoading.style.display = 'flex';
    privacyEmptyState.style.display = 'none';
    redactionImageContainer.style.display = 'none';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) throw new Error('No active browser tab found.');

      if (isRestrictedPage(tab.url)) {
        privacyLoading.style.display = 'none';
        privacyEmptyState.style.display = 'flex';
        privacyEmptyState.innerHTML = `
          <div class="empty-icon">🛡️</div>
          <div>Visual capture is disabled on browser-protected pages (<code>${escapeHtml(tab.url || 'internal page')}</code>). Please open a standard website.</div>
        `;
        redactPreviewBtn.disabled = false;
        return;
      }

      chrome.runtime.sendMessage({ type: 'CAPTURE_AND_REDACT_SCREEN' }, (response) => {
        redactPreviewBtn.disabled = false;
        privacyLoading.style.display = 'none';

        if (response && response.success && response.sanitizedImage) {
          latestSanitizedImage = response.sanitizedImage;
          redactionImageContainer.style.display = 'block';
          sanitizedPreviewImg.src = response.sanitizedImage;
          redactedBadgesCount.textContent = `${response.redactedCount} REDACTED`;
        } else {
          privacyEmptyState.style.display = 'flex';
          privacyEmptyState.innerHTML = `
            <div class="empty-icon">⚠️</div>
            <div>Redaction failed: ${escapeHtml(response?.error || 'Unknown error')}</div>
          `;
        }
      });
    } catch (err) {
      redactPreviewBtn.disabled = false;
      privacyLoading.style.display = 'none';
      privacyEmptyState.style.display = 'flex';
      privacyEmptyState.innerHTML = `
        <div class="empty-icon">⚠️</div>
        <div>Redaction error: ${escapeHtml(err.message)}</div>
      `;
    }
  }

  // -------------------------------------------------------------
  // 5. CHAT SYSTEM & AGENT EXECUTION PIPELINE
  // -------------------------------------------------------------
  function scrollChatToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function appendUserMessage(text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg user-msg';
    msgDiv.innerHTML = `
      <div class="msg-bubble">
        <div class="msg-text">${escapeHtml(text)}</div>
      </div>
    `;
    chatMessages.appendChild(msgDiv);
    scrollChatToBottom();
  }

  function createAgentMessageContainer(initialText) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg agent-msg';

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = '🛡️';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';

    const sender = document.createElement('div');
    sender.className = 'msg-sender';
    sender.textContent = 'Rakshak Agent';

    const textEl = document.createElement('div');
    textEl.className = 'msg-text';
    textEl.textContent = initialText;

    const progressBox = document.createElement('div');
    progressBox.className = 'progress-box';

    const detailsToggle = document.createElement('button');
    detailsToggle.className = 'details-toggle';
    detailsToggle.innerHTML = '<span>▸ Technical Details</span>';
    detailsToggle.style.display = 'none';

    const detailsContent = document.createElement('div');
    detailsContent.className = 'details-content';
    detailsContent.style.display = 'none';

    detailsToggle.addEventListener('click', () => {
      const isHidden = detailsContent.style.display === 'none';
      detailsContent.style.display = isHidden ? 'block' : 'none';
      detailsToggle.innerHTML = isHidden ? '<span>▾ Hide Technical Details</span>' : '<span>▸ Technical Details</span>';
      scrollChatToBottom();
    });

    bubble.appendChild(sender);
    bubble.appendChild(textEl);
    bubble.appendChild(progressBox);
    bubble.appendChild(detailsToggle);
    bubble.appendChild(detailsContent);

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);

    chatMessages.appendChild(msgDiv);
    scrollChatToBottom();

    return {
      msgDiv,
      textEl,
      progressBox,
      detailsToggle,
      detailsContent,
      technicalLogs: [],
      addProgressStep(icon, text, statusClass) {
        const step = document.createElement('div');
        step.className = `progress-step ${statusClass || 'done'}`;
        step.innerHTML = `
          <span class="step-icon">${icon}</span>
          <span class="step-text">${escapeHtml(text)}</span>
        `;
        progressBox.appendChild(step);
        scrollChatToBottom();
        return step;
      },
      addTechnicalDetail(data) {
        this.technicalLogs.push(data);
        this.detailsToggle.style.display = 'flex';
        this.detailsContent.textContent = JSON.stringify(this.technicalLogs, null, 2);
      }
    };
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Format machine actions into human-friendly language
  function formatHumanAction(actionObj, taskPrompt) {
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

  // Ensure scripts are loaded in tab
  async function ensureScriptsInTab(tabId) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: [
          'content/pii_detector.js',
          'content/visual_redactor.js',
          'content/context_collector.js',
          'content/action_executor.js'
        ]
      });
    } catch (e) {
      // Scripts might already be present
    }
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

  async function waitForTabReady(tabId, maxWaitMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      try {
        const tab = await chrome.tabs.get(tabId);
        if (tab.status === 'complete') {
          break;
        }
      } catch (e) {
        // Ignore
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // Safe navigation helper: updates the active tab's URL and waits for it to complete loading
  async function navigateActiveTab(tabId, destinationUrl) {
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

        // Fallback timeout in case onUpdated already fired or stalls
        setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.tabs.get(tabId).then(resolve).catch(resolve);
        }, 6000);
      });
    });
  }

  // Send message on Enter or click
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleUserSubmit();
    }
  });

  chatSendBtn.addEventListener('click', () => {
    handleUserSubmit();
  });

  let currentAgentMsgContainer = null;

  async function handleUserSubmit() {
    const task = chatInput.value.trim();
    if (!task || isAgentRunning) return;

    chatInput.value = '';
    appendUserMessage(task);

    isAgentRunning = true;
    chatSendBtn.disabled = true;
    chatInput.disabled = true;

    currentAgentMsgContainer = createAgentMessageContainer("I'll help with that.");
    currentAgentMsgContainer.addProgressStep('✓', 'Task initiated with background orchestrator', 'done');

    const serverUrl = (serverUrlInput ? serverUrlInput.value.trim().replace(/\/+$/, '') : '') || 'http://localhost:8000';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) throw new Error('No active browser tab found.');

      chrome.runtime.sendMessage({
        type: 'START_AGENT_TASK',
        tabId: tab.id,
        task: task,
        maxSteps: DEFAULT_MAX_STEPS,
        serverUrl: serverUrl
      }, (response) => {
        if (chrome.runtime.lastError || !response || !response.success) {
          currentAgentMsgContainer.addProgressStep('✗', `Failed: ${chrome.runtime.lastError?.message || response?.error || 'Unknown error'}`, 'failed');
          isAgentRunning = false;
          chatSendBtn.disabled = false;
          chatInput.disabled = false;
        }
      });
    } catch (err) {
      currentAgentMsgContainer.addProgressStep('✗', `Error: ${err.message}`, 'failed');
      isAgentRunning = false;
      chatSendBtn.disabled = false;
      chatInput.disabled = false;
    }
  }

  // Listen for state updates from background service worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'AGENT_STATE_UPDATED' && message.state) {
      const state = message.state;
      isAgentRunning = state.isRunning;
      chatSendBtn.disabled = state.isRunning;
      chatInput.disabled = state.isRunning;

      if (state.logs && state.logs.length > 0) {
        if (!currentAgentMsgContainer) {
          currentAgentMsgContainer = createAgentMessageContainer(state.task ? `Working on: "${state.task}"` : undefined);
        }
        currentAgentMsgContainer.progressBox.innerHTML = '';
        state.logs.forEach((log) => {
          currentAgentMsgContainer.addProgressStep(log.icon || '✓', log.text || '', log.statusClass || 'done');
        });
        if (state.technicalLogs && state.technicalLogs.length > 0) {
          currentAgentMsgContainer.detailsContent.textContent = JSON.stringify(state.technicalLogs, null, 2);
          currentAgentMsgContainer.detailsToggle.style.display = 'flex';
        }
      }

      if (state.finalMessage && currentAgentMsgContainer) {
        currentAgentMsgContainer.textEl.textContent = state.finalMessage;
      }
    }
  });

  // Sync state on popup open
  chrome.runtime.sendMessage({ type: 'GET_AGENT_STATE' }, (response) => {
    if (response && response.state && response.state.logs && response.state.logs.length > 0) {
      const state = response.state;
      isAgentRunning = state.isRunning;
      chatSendBtn.disabled = state.isRunning;
      chatInput.disabled = state.isRunning;

      currentAgentMsgContainer = createAgentMessageContainer(state.task ? `Working on: "${state.task}"` : undefined);
      state.logs.forEach((log) => {
        currentAgentMsgContainer.addProgressStep(log.icon || '✓', log.text || '', log.statusClass || 'done');
      });
      if (state.finalMessage) {
        currentAgentMsgContainer.textEl.textContent = state.finalMessage;
      }
    }
  });

  // Local generic goal verification
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

      if (!hasPlayed && !mediaState.isPlaying) {
        // If media is not verified playing yet and play action wasn't triggered
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

    // Search / Query Goals (e.g. "search X", "find X", "lookup X")
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

    // Scroll Goals (e.g. "scroll down", "scroll to see more")
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

    // Click / Submit / Login Goals
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
});
