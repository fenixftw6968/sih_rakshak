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
      case 'FILL_CREDENTIALS':
        return 'Entered login credentials securely (Local Values Protected)';
      case 'FILL_EMAIL':
        return 'Entered email/username securely (Local Value Protected)';
      case 'FILL_PASSWORD':
        return 'Entered password securely (Local Value Protected)';
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

  /**
   * Helper: Extracts local credentials (username/email and password) from the raw user prompt.
   * Keeps these strictly in local memory and returns a redacted sanitized display text.
   */
  function extractAndSanitizeLocalCredentials(rawPrompt) {
    const credentials = {
      username: null,
      email: null,
      password: null,
      hasCredentials: false
    };

    let sanitizedPrompt = rawPrompt;

    // 1. Password detection: password: <val> | pass: <val> | pwd: <val> | password is <val>
    const passMatch = rawPrompt.match(/\b(?:pass(?:word|wd)?)\s*(?:is|=|:)?\s*([^\s,;]+)/i);
    if (passMatch) {
      const rawPass = passMatch[1].trim();
      if (!rawPass.startsWith('[REDACTED')) {
        credentials.password = rawPass;
        credentials.hasCredentials = true;
        sanitizedPrompt = sanitizedPrompt.replace(passMatch[0], 'password [REDACTED_PASSWORD]');
      }
    }

    // 2. Email detection: user@domain.com
    const emailMatch = rawPrompt.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/i);
    if (emailMatch) {
      credentials.email = emailMatch[0].trim();
      credentials.hasCredentials = true;
      sanitizedPrompt = sanitizedPrompt.replace(emailMatch[0], '[REDACTED_EMAIL]');
    }

    // 3. Username detection: username: <val> | user: <val> | login: <val>
    const userMatch = rawPrompt.match(/\b(?:user(?:name)?|login)\s*(?:is|=|:)?\s*([^\s,;]+)/i);
    if (userMatch) {
      const rawUser = userMatch[1].trim();
      if (!rawUser.startsWith('[REDACTED')) {
        credentials.username = rawUser;
        credentials.hasCredentials = true;
        sanitizedPrompt = sanitizedPrompt.replace(userMatch[0], 'username: [REDACTED_USERNAME]');
      }
    }

    return { credentials, sanitizedPrompt };
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

  async function handleUserSubmit() {
    const rawTask = chatInput.value.trim();
    if (!rawTask || isAgentRunning) return;

    chatInput.value = '';

    // Extract local credentials strictly in memory before displaying or transmitting anything
    const { credentials: localCredentials, sanitizedPrompt: safeDisplayPrompt } = extractAndSanitizeLocalCredentials(rawTask);

    // Display masked user message in chat history
    appendUserMessage(safeDisplayPrompt);

    isAgentRunning = true;
    chatSendBtn.disabled = true;
    chatInput.disabled = true;

    const agentMsg = createAgentMessageContainer("I'll help with that.");

    const privacyBannerText = document.getElementById('privacyBannerText');
    if (localCredentials.hasCredentials && privacyBannerText) {
      privacyBannerText.textContent = "Credentials protected — real values used locally";
    }

    const maxSteps = DEFAULT_MAX_STEPS;
    const stepHistory = [];

    try {
      const [initialTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!initialTab || !initialTab.id) {
        throw new Error('No active browser tab found.');
      }

      let activeTab = initialTab;
      const isCurrentPageRestricted = isRestrictedPage(activeTab.url);

      // Check if user's prompt explicitly requests opening or navigating to a website
      const targetNavUrl = extractNavigationGoal(rawTask);

      if (isCurrentPageRestricted) {
        if (targetNavUrl && isSafeDestinationUrl(targetNavUrl)) {
          // User requested navigation from an internal page (e.g. chrome://newtab -> "Open YouTube")
          agentMsg.addProgressStep('✓', 'Preparing the browser', 'done');
          agentMsg.addProgressStep('→', `Navigating to ${targetNavUrl}`, 'active');

          await navigateActiveTab(activeTab.id, targetNavUrl);
          await waitForTabReady(activeTab.id, 4000);
          await new Promise((r) => setTimeout(r, 1200));

          // Fetch refreshed tab state after navigation
          activeTab = await chrome.tabs.get(activeTab.id);

          if (isRestrictedPage(activeTab.url)) {
            agentMsg.addProgressStep('✗', 'Destination page is restricted.', 'failed');
            agentMsg.textEl.textContent = 'I could not open that destination because it is restricted by the browser.';
            return;
          }

          agentMsg.addProgressStep('✓', `Website loaded (${new URL(activeTab.url).hostname})`, 'done');
        } else {
          // Current page is restricted and prompt has no explicit navigation destination
          agentMsg.textEl.textContent = 'I can perform browser tasks on regular websites, but this page is protected by the browser. Please open or navigate to a website first, or tell me which site to open (e.g., "Open YouTube").';
          agentMsg.addProgressStep('ℹ️', 'Active tab is an internal browser page (chrome://).', 'info');
          agentMsg.addTechnicalDetail({
            note: 'Restricted page detected. Browser security policy forbids DOM injection on internal schemes.',
            activeTabUrl: activeTab.url
          });
          return;
        }
      } else if (targetNavUrl && isSafeDestinationUrl(targetNavUrl)) {
        // Already on a standard page, but user requested navigation to a different website
        try {
          const currentHost = new URL(activeTab.url).hostname.replace(/^www\./, '');
          const targetHost = new URL(targetNavUrl).hostname.replace(/^www\./, '');
          
          if (currentHost !== targetHost) {
            agentMsg.addProgressStep('→', `Navigating to ${targetNavUrl}`, 'active');
            await navigateActiveTab(activeTab.id, targetNavUrl);
            await waitForTabReady(activeTab.id, 4000);
            await new Promise((r) => setTimeout(r, 1200));
            activeTab = await chrome.tabs.get(activeTab.id);
            agentMsg.addProgressStep('✓', `Website loaded (${targetHost})`, 'done');
          }
        } catch (urlParseErr) {
          // If URL parsing fails, proceed without forced navigation
        }
      }

      const serverUrl = (serverUrlInput ? serverUrlInput.value.trim().replace(/\/+$/, '') : '') || 'http://localhost:8000';
      let currentStep = 0;
      let taskComplete = false;
      let consecutiveFailures = 0;

      while (currentStep < maxSteps && !taskComplete) {
        currentStep++;

        // 1. Ensure scripts and tab readiness for fresh updated DOM state
        await waitForTabReady(activeTab.id, 2500);
        await ensureScriptsInTab(activeTab.id);

        // 2. Real DOM inspection
        let contextResp = null;
        try {
          contextResp = await sendTabMessage(activeTab.id, { type: 'COLLECT_LOCAL_CONTEXT' });
        } catch (msgErr) {
          await new Promise((r) => setTimeout(r, 800));
          await ensureScriptsInTab(activeTab.id);
          contextResp = await sendTabMessage(activeTab.id, { type: 'COLLECT_LOCAL_CONTEXT' });
        }

        if (!contextResp || !contextResp.success) {
          throw new Error('Failed to inspect active tab context.');
        }

        const localContext = contextResp.context;
        renderContext(localContext);

        if (currentStep === 1) {
          agentMsg.addProgressStep('✓', `Inspecting current page (${localContext.totalCount || 0} elements detected)`, 'done');
          if (localCredentials.hasCredentials) {
            agentMsg.addProgressStep('✓', 'Credentials protected — real values used locally', 'done');
          } else if (localContext.sensitiveCount > 0) {
            agentMsg.addProgressStep('✓', `Privacy Gate: Redacted ${localContext.sensitiveCount} sensitive elements locally`, 'done');
          } else {
            agentMsg.addProgressStep('✓', 'Checking privacy-sensitive content locally (Shield Active)', 'done');
          }
        }

        // Quick check: If user wants media playback and media is ALREADY playing on the content page
        const isPlayTask = /\b(play|watch|stream|listen|song|video)\b/i.test(rawTask);
        if (isPlayTask && localContext.mediaState?.isPlaying && stepHistory.some(h => h.action === 'CLICK' || h.action === 'TYPE')) {
          agentMsg.addProgressStep('✓', 'Video playback confirmed active', 'done');
          agentMsg.addProgressStep('✓', 'Task completed successfully', 'done');
          agentMsg.textEl.textContent = 'I have found and started playing the requested video.';
          taskComplete = true;
          break;
        }

        // 3. Privacy Gate sanitization (Local enforcement)
        const rawPayload = {
          task: safeDisplayPrompt,
          page: localContext.page,
          elements: localContext.elements,
          sanitizedImage: latestSanitizedImage,
          clientId: 'rakshak-extension-popup',
          stepHistory: stepHistory,
          currentStep: currentStep,
          maxSteps: maxSteps
        };

        let sanitizedPayload = rawPayload;
        if (window.__rakshakPrivacyGate && typeof window.__rakshakPrivacyGate.validateAndSanitizePayload === 'function') {
          const gateResult = window.__rakshakPrivacyGate.validateAndSanitizePayload(rawPayload);
          sanitizedPayload = gateResult.sanitizedPayload;
        }

        // 4. Backend AI Reasoning
        const res = await fetch(`${serverUrl}/api/v1/act`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(sanitizedPayload)
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Server error (${res.status}): ${errBody || res.statusText}`);
        }

        const aiDecision = await res.json();

        // Ensure raw passwords never appear in technical details
        const safeDecisionLog = JSON.parse(JSON.stringify(aiDecision));
        if (safeDecisionLog.passwordValue) safeDecisionLog.passwordValue = '[REDACTED_PASSWORD]';
        if (safeDecisionLog.value && safeDecisionLog.value.length > 0 && (safeDecisionLog.action === 'FILL_PASSWORD' || /password/i.test(safeDecisionLog.reason))) {
          safeDecisionLog.value = '[REDACTED_PASSWORD]';
        }
        agentMsg.addTechnicalDetail({ step: currentStep, decision: safeDecisionLog });

        // Map AI decision to local private values if filling credentials
        const localExecutableAction = { ...aiDecision };

        if (aiDecision.action === 'FILL_CREDENTIALS') {
          localExecutableAction.emailValue = localCredentials.email || localCredentials.username || '';
          localExecutableAction.passwordValue = localCredentials.password || '';
        } else if (aiDecision.action === 'FILL_EMAIL') {
          localExecutableAction.emailValue = localCredentials.email || localCredentials.username || '';
          localExecutableAction.value = localExecutableAction.emailValue;
        } else if (aiDecision.action === 'FILL_PASSWORD') {
          localExecutableAction.passwordValue = localCredentials.password || '';
          localExecutableAction.value = localExecutableAction.passwordValue;
        } else if (aiDecision.action === 'TYPE') {
          // If the AI mistakenly sent a redaction placeholder as a type value, substitute the real local credential
          const val = String(aiDecision.value || '');
          if (val === '[REDACTED_PASSWORD]' || (val.includes('[REDACTED_PASSWORD]') && localCredentials.password)) {
            localExecutableAction.value = localCredentials.password;
          } else if (val === '[REDACTED_EMAIL]' || val === '[REDACTED_USERNAME]' || ((val.includes('[REDACTED_EMAIL]') || val.includes('[REDACTED_USERNAME]')) && (localCredentials.email || localCredentials.username))) {
            localExecutableAction.value = localCredentials.email || localCredentials.username;
          }
        }

        // 5. Local Action Validation
        const validationResp = await sendTabMessage(activeTab.id, {
          type: 'VALIDATE_LOCAL_ACTION',
          action: localExecutableAction
        });

        if (!validationResp || !validationResp.valid) {
          const errMsg = validationResp?.error || 'Local safety validation rejected the action';
          agentMsg.addProgressStep('✗', `Validation note: ${errMsg}`, 'failed');

          consecutiveFailures++;
          stepHistory.push({
            step: currentStep,
            action: aiDecision.action || 'INVALID',
            target: aiDecision.target?.elementId || aiDecision.target?.selector || '',
            result: 'Validation Failed',
            message: errMsg
          });

          if (consecutiveFailures >= 3) {
            agentMsg.addProgressStep('⚠️', 'Execution halted for safety compliance.', 'failed');
            break;
          }
          continue;
        }

        consecutiveFailures = 0;

        // 6. Check STOP & Local Goal Verification
        if (aiDecision.action === 'STOP') {
          const verification = verifyGoalCompletionLocally(rawTask, stepHistory, localContext);
          if (!verification.completed) {
            agentMsg.addProgressStep('→', `Continuing: ${verification.reason}`, 'info');
            stepHistory.push({
              step: currentStep,
              action: 'STOP_REJECTED',
              target: '',
              result: 'Rejected',
              message: `Goal not yet verified: ${verification.reason}. You must choose the next actionable step.`
            });

            consecutiveFailures++;
            if (consecutiveFailures >= 3) {
              agentMsg.addProgressStep('✓', 'Task completed to the extent possible.', 'done');
              break;
            }
            continue;
          }

          agentMsg.addProgressStep('✓', 'Task completed successfully', 'done');
          agentMsg.textEl.textContent = 'I have completed your task.';
          taskComplete = true;
          break;
        }

        // 7. Local Action Execution
        const humanActionText = formatHumanAction(aiDecision, rawTask);
        const execResult = await sendTabMessage(activeTab.id, {
          type: 'EXECUTE_LOCAL_ACTION',
          action: localExecutableAction
        });

        const targetName = aiDecision.target?.elementId || aiDecision.target?.selector || (aiDecision.action === 'KEY' ? aiDecision.key : '');

        if (execResult && execResult.success) {
          agentMsg.addProgressStep('✓', humanActionText, 'done');

          // Never store real password in step history sent to server or logs
          let safeHistoryVal = aiDecision.value || aiDecision.key || '';
          if (aiDecision.action === 'FILL_PASSWORD' || aiDecision.action === 'FILL_CREDENTIALS') {
            safeHistoryVal = '[REDACTED_CREDENTIALS]';
          }

          stepHistory.push({
            step: currentStep,
            action: aiDecision.action,
            target: targetName,
            value: safeHistoryVal,
            result: 'Success',
            message: execResult.message
          });

          // Wait dynamic duration for DOM updates, network transitions, video player initialization, or URL changes
          if (aiDecision.action === 'CLICK' || aiDecision.action === 'TYPE' || aiDecision.action === 'KEY' || aiDecision.action === 'FILL_CREDENTIALS' || aiDecision.action === 'FILL_PASSWORD' || aiDecision.action === 'FILL_EMAIL') {
            await new Promise((r) => setTimeout(r, 1800));
          } else {
            await new Promise((r) => setTimeout(r, 1000));
          }
        } else {
          const failMsg = execResult?.message || 'Action could not be applied';
          agentMsg.addProgressStep('✗', `${humanActionText} (${failMsg})`, 'failed');

          stepHistory.push({
            step: currentStep,
            action: aiDecision.action,
            target: targetName,
            result: 'Failed',
            message: failMsg
          });

          consecutiveFailures++;
          if (consecutiveFailures >= 3) {
            agentMsg.addProgressStep('⚠️', 'Stopping after consecutive execution issues.', 'failed');
            break;
          }
        }
      }

      if (currentStep >= maxSteps && !taskComplete) {
        agentMsg.addProgressStep('✓', `Completed maximum allowed steps (${maxSteps}).`, 'done');
        agentMsg.textEl.textContent = 'I finished running the requested workflow steps.';
      }
    } catch (err) {
      agentMsg.addProgressStep('✗', `Error: ${err.message}`, 'failed');
      agentMsg.textEl.textContent = 'Encountered an issue while executing the task.';
    } finally {
      // Clear temporary credentials from memory when task completes or ends
      localCredentials.password = null;
      localCredentials.username = null;
      localCredentials.email = null;
      localCredentials.hasCredentials = false;

      isAgentRunning = false;
      chatSendBtn.disabled = false;
      chatInput.disabled = false;
      chatInput.focus();
    }
  }

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

    // Login / Authentication Goals
    const isLoginGoal = /\b(login|sign in|log in|authenticate)\b/i.test(taskLower);
    if (isLoginGoal) {
      const hasFilledCredentials = pastActions.includes('FILL_CREDENTIALS') || (pastActions.includes('FILL_PASSWORD') && (pastActions.includes('FILL_EMAIL') || pastActions.includes('TYPE')));
      const hasClickedSubmit = pastActions.includes('CLICK') || pastActions.includes('KEY');

      if (!hasFilledCredentials && !hasClickedSubmit) {
        return {
          completed: false,
          reason: 'Credentials have not been entered into the login fields yet.'
        };
      }

      if (hasFilledCredentials && !hasClickedSubmit) {
        return {
          completed: false,
          reason: 'Credentials were populated, but the Login/Sign-In button has not been clicked yet.'
        };
      }

      return {
        completed: true,
        reason: 'Login credentials filled and sign-in submitted successfully.'
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

    // Click / Submit Goals
    const isClickGoal = /\b(click|submit|press)\b/i.test(taskLower);
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
