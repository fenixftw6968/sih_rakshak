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
  let isAgentRunning = false;
  const DEFAULT_MAX_STEPS = 12;
  let currentAgentMsgContainer = null;

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
      inspectTab.style.display = 'block';
      tabInspectBtn.classList.add('active');
    } else if (targetTab === 'privacy') {
      privacyTab.style.display = 'block';
      tabPrivacyBtn.classList.add('active');
    }
  }

  tabChatBtn?.addEventListener('click', () => switchTab('chat'));
  tabInspectBtn?.addEventListener('click', () => switchTab('inspect'));
  tabPrivacyBtn?.addEventListener('click', () => switchTab('privacy'));

  devToggleBtn?.addEventListener('click', () => {
    diagnosticsDrawer.style.display = diagnosticsDrawer.style.display === 'none' ? 'block' : 'none';
  });

  closeDrawerBtn?.addEventListener('click', () => {
    diagnosticsDrawer.style.display = 'none';
  });

  // -------------------------------------------------------------
  // 2. SERVER CONNECTION & TELEMETRY
  // -------------------------------------------------------------
  async function checkServerHealth(quiet = false) {
    const serverUrl = (serverUrlInput ? serverUrlInput.value.trim().replace(/\/+$/, '') : '') || 'http://localhost:8000';
    if (!quiet) {
      statusBadge.className = 'status-badge checking';
      statusText.textContent = 'Checking...';
    }

    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'PING_SERVER', serverUrl: serverUrl }, (res) => {
          if (chrome.runtime.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res);
          }
        });
      });

      if (resp && resp.success) {
        statusBadge.className = 'status-badge online';
        statusText.textContent = 'Online';

        if (serverInfoCard) {
          serverInfoCard.style.display = 'block';
          latencyVal.textContent = `${resp.latencyMs || 0}ms`;
          providerVal.textContent = resp.data?.mode || 'Auto (Router)';
          hfVal.textContent = resp.data?.providers?.huggingface?.primary_model || 'Qwen2.5-VL-72B';
          geminiVal.textContent = resp.data?.providers?.gemini?.primary_model || 'Gemini 3.1 Flash Lite';
        }
      } else {
        statusBadge.className = 'status-badge offline';
        statusText.textContent = 'Offline';
        if (serverInfoCard) serverInfoCard.style.display = 'none';
      }
    } catch (e) {
      statusBadge.className = 'status-badge offline';
      statusText.textContent = 'Offline';
      if (serverInfoCard) serverInfoCard.style.display = 'none';
    }
  }

  testConnBtn?.addEventListener('click', () => checkServerHealth(false));
  checkServerHealth(true);

  // -------------------------------------------------------------
  // 3. UI RENDERING HELPERS
  // -------------------------------------------------------------
  function appendUserMessage(text) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg user-msg';
    msgDiv.innerHTML = `
      <div class="msg-bubble">
        <div class="msg-sender">You</div>
        <div class="msg-text">${escapeHtml(text)}</div>
      </div>
    `;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function createAgentMessageContainer(initialText) {
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg agent-msg';

    msgDiv.innerHTML = `
      <div class="msg-avatar">🛡️</div>
      <div class="msg-bubble">
        <div class="msg-sender">Rakshak Agent</div>
        <div class="msg-text">${escapeHtml(initialText || "I'll help with that.")}</div>
        <div class="progress-container"></div>
        <button class="details-toggle" style="display: none;">
          <span>Technical details</span>
          <span class="chevron">▼</span>
        </button>
        <div class="details-content" style="display: none;"></div>
      </div>
    `;

    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    const progressBox = msgDiv.querySelector('.progress-container');
    const detailsToggle = msgDiv.querySelector('.details-toggle');
    const detailsContent = msgDiv.querySelector('.details-content');
    const textEl = msgDiv.querySelector('.msg-text');

    detailsToggle.addEventListener('click', () => {
      const isVisible = detailsContent.style.display !== 'none';
      detailsContent.style.display = isVisible ? 'none' : 'block';
      detailsToggle.querySelector('.chevron').textContent = isVisible ? '▼' : '▲';
    });

    return {
      container: msgDiv,
      textEl,
      progressBox,
      detailsToggle,
      detailsContent,
      addProgressStep: (icon, text, statusClass = 'done') => {
        const step = document.createElement('div');
        step.className = `progress-step ${statusClass}`;
        step.innerHTML = `<span class="step-icon">${icon}</span><span class="step-text">${escapeHtml(text)}</span>`;
        progressBox.appendChild(step);
        chatMessages.scrollTop = chatMessages.scrollHeight;
      }
    };
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // -------------------------------------------------------------
  // 4. TASK SUBMISSION & BACKGROUND SYNC
  // -------------------------------------------------------------
  function extractAndSanitizeLocalCredentials(rawPrompt) {
    const credentials = {
      username: null,
      email: null,
      password: null,
      hasCredentials: false
    };

    let sanitizedPrompt = rawPrompt;

    const passMatch = rawPrompt.match(/\b(?:pass(?:word|wword|wd)?|pwd)\s*(?:is|=|:)?\s*([^\s,;]+)/i);
    if (passMatch) {
      const rawPass = passMatch[1].trim();
      if (!rawPass.startsWith('[REDACTED')) {
        credentials.password = rawPass;
        credentials.hasCredentials = true;
        sanitizedPrompt = sanitizedPrompt.replace(passMatch[0], 'password [REDACTED_PASSWORD]');
      }
    }

    const emailMatch = rawPrompt.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/i);
    if (emailMatch) {
      credentials.email = emailMatch[0].trim();
      credentials.hasCredentials = true;
      sanitizedPrompt = sanitizedPrompt.replace(emailMatch[0], '[REDACTED_EMAIL]');
    }

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

  chatInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleUserSubmit();
    }
  });

  chatSendBtn?.addEventListener('click', () => {
    handleUserSubmit();
  });

  async function handleUserSubmit() {
    const rawTask = chatInput.value.trim();
    if (!rawTask || isAgentRunning) return;

    chatInput.value = '';

    const { credentials: localCredentials, sanitizedPrompt: safeDisplayPrompt } = extractAndSanitizeLocalCredentials(rawTask);

    appendUserMessage(safeDisplayPrompt);

    isAgentRunning = true;
    chatSendBtn.disabled = true;
    chatInput.disabled = true;

    currentAgentMsgContainer = createAgentMessageContainer("I'll help with that.");
    currentAgentMsgContainer.addProgressStep('✓', 'Task initiated with background orchestrator', 'done');

    const privacyBannerText = document.getElementById('privacyBannerText');
    if (localCredentials.hasCredentials && privacyBannerText) {
      privacyBannerText.textContent = 'Credentials protected — real values used locally';
    }

    const serverUrl = (serverUrlInput ? serverUrlInput.value.trim().replace(/\/+$/, '') : '') || 'http://localhost:8000';

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) throw new Error('No active browser tab found.');

      chrome.runtime.sendMessage({
        type: 'START_AGENT_TASK',
        tabId: tab.id,
        task: rawTask,
        localCredentials: localCredentials,
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
});
