/**
 * Rakshak In-Page Overlay Agent
 * Injected as a persistent floating widget in an isolated Shadow DOM container.
 * Remains active across user clicks, tab switches, and window focus changes.
 */

(function () {
  'use strict';

  // Prevent multiple injections
  if (window.__rakshakOverlayInitialized) {
    return;
  }
  window.__rakshakOverlayInitialized = true;

  const OVERLAY_ROOT_ID = 'rakshak-agent-overlay-root';
  let hostElement = null;
  let shadowRoot = null;
  let isMinimized = false;
  let isDragging = false;
  let dragStartX, dragStartY, initialLeft, initialTop;

  // Local state cache
  let currentState = {
    isRunning: false,
    taskId: null,
    task: '',
    currentStep: 0,
    maxSteps: 12,
    status: 'idle',
    stepHistory: [],
    logs: [],
    serverUrl: 'http://localhost:8000',
    serverConnected: false,
    serverTelemetry: null,
    latestSanitizedImage: null,
    redactedCount: 0
  };

  // ---------------------------------------------------------------------------
  // 1. STYLES & SHADOW DOM INJECTION
  // ---------------------------------------------------------------------------
  const OVERLAY_CSS = `
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    :host {
      all: initial;
      z-index: 2147483647;
      position: fixed;
      pointer-events: none;
    }

    .overlay-container {
      pointer-events: auto;
      position: fixed;
      bottom: 24px;
      right: 24px;
      width: 390px;
      height: 590px;
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 32px);
      background: rgba(13, 17, 23, 0.96);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(48, 54, 61, 0.9);
      border-radius: 14px;
      box-shadow: 0 12px 40px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(88, 166, 255, 0.15);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      color: #c9d1d9;
      font-size: 13px;
      transition: height 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease, transform 0.25s ease;
      user-select: none;
    }

    .overlay-container.minimized {
      height: 52px;
      width: 220px;
      cursor: pointer;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5), 0 0 12px rgba(88, 166, 255, 0.3);
    }

    .overlay-container.hidden {
      display: none !important;
    }

    /* HEADER */
    .overlay-header {
      padding: 10px 14px;
      background: rgba(22, 27, 34, 0.95);
      border-bottom: 1px solid #30363d;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: move;
      flex-shrink: 0;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 9px;
      overflow: hidden;
    }

    .logo-badge {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: linear-gradient(135deg, #1f6feb 0%, #1158c7 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      box-shadow: 0 2px 8px rgba(31, 111, 235, 0.4);
      flex-shrink: 0;
    }

    .header-title-wrap {
      display: flex;
      flex-direction: column;
    }

    .app-name {
      font-weight: 700;
      font-size: 13px;
      color: #f0f6fc;
      letter-spacing: 0.3px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .header-status-badge {
      font-size: 10px;
      display: flex;
      align-items: center;
      gap: 4px;
      color: #8b949e;
    }

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: #8b949e;
      transition: background 0.3s ease;
    }

    .status-dot.connected { background: #3fb950; box-shadow: 0 0 6px rgba(63, 185, 80, 0.6); }
    .status-dot.running { background: #58a6ff; box-shadow: 0 0 8px rgba(88, 166, 255, 0.8); animation: pulse 1.5s infinite; }
    .status-dot.disconnected { background: #f85149; }

    @keyframes pulse {
      0% { transform: scale(0.95); opacity: 0.8; }
      50% { transform: scale(1.2); opacity: 1; }
      100% { transform: scale(0.95); opacity: 0.8; }
    }

    .header-controls {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .icon-btn {
      background: transparent;
      border: none;
      color: #8b949e;
      cursor: pointer;
      width: 26px;
      height: 26px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      transition: background 0.15s ease, color 0.15s ease;
    }

    .icon-btn:hover {
      background: #21262d;
      color: #f0f6fc;
    }

    .icon-btn.close-btn:hover {
      background: rgba(248, 81, 73, 0.2);
      color: #f85149;
    }

    /* NAVIGATION TABS */
    .nav-bar {
      display: flex;
      background: #161b22;
      border-bottom: 1px solid #30363d;
      padding: 0 6px;
      flex-shrink: 0;
    }

    .nav-tab {
      flex: 1;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      padding: 7px 4px;
      color: #8b949e;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      transition: all 0.15s ease;
    }

    .nav-tab:hover {
      color: #c9d1d9;
    }

    .nav-tab.active {
      color: #58a6ff;
      border-bottom-color: #58a6ff;
      background: rgba(56, 139, 253, 0.06);
    }

    /* PRIVACY BANNER */
    .privacy-banner {
      background: rgba(35, 134, 54, 0.12);
      border-bottom: 1px solid rgba(46, 160, 67, 0.3);
      padding: 5px 12px;
      font-size: 10.5px;
      color: #7ee787;
      display: flex;
      align-items: center;
      gap: 6px;
      flex-shrink: 0;
    }

    /* MAIN CONTENT */
    .overlay-main {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      position: relative;
    }

    .tab-view {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .tab-view.hidden {
      display: none !important;
    }

    /* CHAT & STEPS VIEW */
    .chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      user-select: text;
    }

    .chat-msg {
      display: flex;
      gap: 8px;
      max-width: 94%;
    }

    .chat-msg.user-msg {
      align-self: flex-end;
      flex-direction: row-reverse;
    }

    .chat-msg.agent-msg {
      align-self: flex-start;
      width: 100%;
      max-width: 100%;
    }

    .msg-avatar {
      width: 26px;
      height: 26px;
      border-radius: 6px;
      background: #21262d;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      flex-shrink: 0;
    }

    .msg-bubble {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 10px;
      padding: 8px 11px;
      color: #e6edf3;
      font-size: 12px;
      line-height: 1.45;
      width: 100%;
    }

    .user-msg .msg-bubble {
      background: #1f6feb;
      border-color: #388bfd;
      color: #ffffff;
      border-bottom-right-radius: 3px;
    }

    .agent-msg .msg-bubble {
      border-top-left-radius: 3px;
    }

    .msg-sender {
      font-size: 10.5px;
      font-weight: 600;
      color: #58a6ff;
      margin-bottom: 3px;
    }

    .progress-box {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .progress-step {
      background: #0d1117;
      border: 1px solid #21262d;
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 11px;
      display: flex;
      align-items: flex-start;
      gap: 6px;
      line-height: 1.35;
    }

    .progress-step.done {
      border-left: 3px solid #3fb950;
    }

    .progress-step.active {
      border-left: 3px solid #58a6ff;
      background: rgba(56, 139, 253, 0.08);
    }

    .progress-step.failed {
      border-left: 3px solid #f85149;
    }

    .progress-step.info {
      border-left: 3px solid #d29922;
    }

    .step-icon {
      font-weight: bold;
      flex-shrink: 0;
    }

    .progress-step.done .step-icon { color: #3fb950; }
    .progress-step.active .step-icon { color: #58a6ff; }
    .progress-step.failed .step-icon { color: #f85149; }
    .progress-step.info .step-icon { color: #d29922; }

    .step-text {
      color: #c9d1d9;
      word-break: break-word;
    }

    .details-toggle {
      background: none;
      border: none;
      color: #58a6ff;
      font-size: 10px;
      cursor: pointer;
      margin-top: 6px;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      padding: 0;
    }

    .details-content {
      margin-top: 6px;
      background: #090d13;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 6px 8px;
      font-family: monospace;
      font-size: 10px;
      color: #8b949e;
      max-height: 120px;
      overflow-y: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }

    /* INPUT SECTION */
    .input-section {
      padding: 10px 12px;
      background: #161b22;
      border-top: 1px solid #30363d;
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
    }

    .input-row {
      display: flex;
      gap: 6px;
      align-items: center;
    }

    .chat-input {
      flex: 1;
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 8px 10px;
      color: #f0f6fc;
      font-size: 12px;
      outline: none;
      transition: border-color 0.15s ease;
      user-select: text;
    }

    .chat-input:focus {
      border-color: #58a6ff;
      box-shadow: 0 0 0 2px rgba(88, 166, 255, 0.2);
    }

    .action-btn {
      background: #1f6feb;
      border: none;
      color: #ffffff;
      padding: 8px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 5px;
      transition: background 0.15s ease, opacity 0.15s ease;
      flex-shrink: 0;
    }

    .action-btn:hover:not(:disabled) {
      background: #388bfd;
    }

    .action-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .stop-btn {
      background: #da3633;
    }

    .stop-btn:hover:not(:disabled) {
      background: #f85149;
    }

    .input-hint {
      font-size: 10px;
      color: #8b949e;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    /* INSPECT TAB */
    .tab-padding {
      padding: 12px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .panel-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .panel-title {
      font-weight: 600;
      font-size: 13px;
      color: #f0f6fc;
    }

    .btn-secondary {
      background: #21262d;
      border: 1px solid #30363d;
      color: #c9d1d9;
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 11px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: background 0.15s ease;
    }

    .btn-secondary:hover {
      background: #30363d;
      color: #f0f6fc;
    }

    .stat-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }

    .stat-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 6px;
      padding: 6px 8px;
    }

    .stat-label {
      font-size: 9.5px;
      color: #8b949e;
      text-transform: uppercase;
    }

    .stat-val {
      font-size: 12px;
      font-weight: 600;
      color: #f0f6fc;
      margin-top: 2px;
    }

    .elements-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 250px;
      overflow-y: auto;
    }

    .el-item {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 4px;
      padding: 4px 6px;
      font-size: 10.5px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .el-item.sensitive {
      border-color: #f85149;
    }

    /* PRIVACY TAB */
    .preview-card {
      background: #161b22;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .preview-img-box {
      width: 100%;
      height: 200px;
      background: #090d13;
      border-radius: 6px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 1px solid #21262d;
    }

    .preview-img-box img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }

    /* CONFIG / SETTINGS */
    .setting-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .setting-label {
      font-size: 11px;
      color: #8b949e;
    }

    /* SCROLLBAR */
    ::-webkit-scrollbar {
      width: 5px;
      height: 5px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: #30363d;
      border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: #484f58;
    }
  `;

  // ---------------------------------------------------------------------------
  // 2. CREATE OVERLAY DOM
  // ---------------------------------------------------------------------------
  function initOverlay() {
    if (document.getElementById(OVERLAY_ROOT_ID)) {
      hostElement = document.getElementById(OVERLAY_ROOT_ID);
      shadowRoot = hostElement.shadowRoot;
      return;
    }

    hostElement = document.createElement('div');
    hostElement.id = OVERLAY_ROOT_ID;
    hostElement.setAttribute('data-rakshak-overlay', 'true');
    shadowRoot = hostElement.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = OVERLAY_CSS;
    shadowRoot.appendChild(styleEl);

    const container = document.createElement('div');
    container.className = 'overlay-container';
    container.id = 'rakshakContainer';

    container.innerHTML = `
      <!-- HEADER -->
      <div class="overlay-header" id="overlayHeader">
        <div class="header-left">
          <div class="logo-badge">🛡️</div>
          <div class="header-title-wrap">
            <div class="app-name">Rakshak Vision Agent</div>
            <div class="header-status-badge">
              <div class="status-dot disconnected" id="headerStatusDot"></div>
              <span id="headerStatusText">Checking</span>
            </div>
          </div>
        </div>
        <div class="header-controls">
          <button class="icon-btn" id="minimizeBtn" title="Minimize / Expand" aria-label="Minimize">—</button>
          <button class="icon-btn close-btn" id="closeBtn" title="Close Overlay" aria-label="Close">✕</button>
        </div>
      </div>

      <!-- TABS -->
      <div class="nav-bar" id="navBar">
        <button class="nav-tab active" data-tab="chat">💬 Agent</button>
        <button class="nav-tab" data-tab="inspect">🔍 Inspect</button>
        <button class="nav-tab" data-tab="privacy">🛡️ Privacy</button>
        <button class="nav-tab" data-tab="config">⚙️ Config</button>
      </div>

      <!-- PRIVACY SHIELD BADGE -->
      <div class="privacy-banner" id="privacyBanner">
        <span>🔒</span>
        <span>Local Privacy Shield Active &bull; Zero raw PII leaves browser</span>
      </div>

      <!-- MAIN TABS CONTAINER -->
      <div class="overlay-main" id="overlayMain">
        <!-- 1. CHAT VIEW -->
        <div class="tab-view" id="viewChat">
          <div class="chat-messages" id="chatMessages">
            <div class="chat-msg agent-msg">
              <div class="msg-avatar">🛡️</div>
              <div class="msg-bubble">
                <div class="msg-sender">Rakshak Agent</div>
                <div class="msg-text">Hello! I am your privacy-preserving browser vision agent. Enter a task below to get started.</div>
              </div>
            </div>
          </div>

          <div class="input-section">
            <div class="input-row">
              <input type="text" class="chat-input" id="chatInput" placeholder="Ask Rakshak to perform a task on this page..." autocomplete="off" />
              <button class="action-btn" id="sendBtn" title="Execute Task">
                <span>➤</span>
              </button>
              <button class="action-btn stop-btn" id="stopBtn" style="display: none;" title="Stop Execution">
                <span>⏹ Stop</span>
              </button>
            </div>
            <div class="input-hint">
              <span id="stepIndicator">Ready</span>
              <span>Local Redaction Active</span>
            </div>
          </div>
        </div>

        <!-- 2. INSPECT VIEW -->
        <div class="tab-view hidden" id="viewInspect">
          <div class="tab-padding">
            <div class="panel-row">
              <div class="panel-title">Page DOM Inspection</div>
              <button class="btn-secondary" id="inspectRefreshBtn">🔄 Re-Inspect</button>
            </div>
            <div class="stat-grid">
              <div class="stat-card">
                <div class="stat-label">Page Title</div>
                <div class="stat-val" id="statTitle">-</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Elements</div>
                <div class="stat-val" id="statElements">0</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Sensitive Items</div>
                <div class="stat-val" id="statSensitive" style="color: #f85149;">0 Detected</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Privacy Shield</div>
                <div class="stat-val" style="color: #3fb950;">🔒 Local Only</div>
              </div>
            </div>
            <div class="stat-label" style="margin-top: 4px;">Detected Interactive Elements:</div>
            <div class="elements-list" id="elementsList"></div>
          </div>
        </div>

        <!-- 3. PRIVACY VIEW -->
        <div class="tab-view hidden" id="viewPrivacy">
          <div class="tab-padding">
            <div class="panel-row">
              <div class="panel-title">Local Visual Redaction</div>
              <button class="btn-secondary" id="runRedactionBtn">🎨 Run Preview</button>
            </div>
            <div class="preview-card">
              <div class="stat-label">Sanitized Screen Snapshot</div>
              <div class="preview-img-box" id="previewBox">
                <span style="color: #8b949e; font-size: 11px;">Click 'Run Preview' to capture & redact</span>
              </div>
              <div class="stat-label" id="redactedBadgeCount" style="color: #3fb950;">0 REDACTIONS</div>
            </div>
          </div>
        </div>

        <!-- 4. CONFIG VIEW -->
        <div class="tab-view hidden" id="viewConfig">
          <div class="tab-padding">
            <div class="panel-title">Server Telemetry & Settings</div>
            <div class="setting-group">
              <div class="setting-label">Backend Reasoning Server</div>
              <div style="display: flex; gap: 6px;">
                <input type="text" class="chat-input" id="serverUrlInput" value="http://localhost:8000" style="flex: 1;" />
                <button class="btn-secondary" id="testServerBtn">Test</button>
              </div>
            </div>
            <div class="stat-grid" style="margin-top: 6px;">
              <div class="stat-card">
                <div class="stat-label">Latency</div>
                <div class="stat-val" id="cfgLatency">-</div>
              </div>
              <div class="stat-card">
                <div class="stat-label">Provider</div>
                <div class="stat-val" id="cfgProvider">-</div>
              </div>
              <div class="stat-card" style="grid-column: span 2;">
                <div class="stat-label">Primary HF Model</div>
                <div class="stat-val" id="cfgHf">-</div>
              </div>
              <div class="stat-card" style="grid-column: span 2;">
                <div class="stat-label">Gemini Fallback</div>
                <div class="stat-val" id="cfgGemini">-</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    shadowRoot.appendChild(container);
    (document.body || document.documentElement).appendChild(hostElement);

    setupOverlayEventListeners();
    syncWithBackgroundState();
  }

  // ---------------------------------------------------------------------------
  // 3. EVENT LISTENERS & DRAGGING
  // ---------------------------------------------------------------------------
  function setupOverlayEventListeners() {
    const container = shadowRoot.getElementById('rakshakContainer');
    const header = shadowRoot.getElementById('overlayHeader');
    const minimizeBtn = shadowRoot.getElementById('minimizeBtn');
    const closeBtn = shadowRoot.getElementById('closeBtn');
    const navTabs = shadowRoot.querySelectorAll('.nav-tab');
    const chatInput = shadowRoot.getElementById('chatInput');
    const sendBtn = shadowRoot.getElementById('sendBtn');
    const stopBtn = shadowRoot.getElementById('stopBtn');
    const inspectRefreshBtn = shadowRoot.getElementById('inspectRefreshBtn');
    const runRedactionBtn = shadowRoot.getElementById('runRedactionBtn');
    const testServerBtn = shadowRoot.getElementById('testServerBtn');
    const serverUrlInput = shadowRoot.getElementById('serverUrlInput');

    // Dragging logic
    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.icon-btn')) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;

      const rect = container.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      // Unset bottom/right to allow absolute positioning on drag
      container.style.bottom = 'auto';
      container.style.right = 'auto';
      container.style.left = `${initialLeft}px`;
      container.style.top = `${initialTop}px`;

      e.preventDefault();
    });

    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - dragStartX;
      const deltaY = e.clientY - dragStartY;

      let newLeft = initialLeft + deltaX;
      let newTop = initialTop + deltaY;

      // Bound within window
      const maxLeft = window.innerWidth - container.offsetWidth;
      const maxTop = window.innerHeight - container.offsetHeight;

      newLeft = Math.max(0, Math.min(newLeft, maxLeft));
      newTop = Math.max(0, Math.min(newTop, maxTop));

      container.style.left = `${newLeft}px`;
      container.style.top = `${newTop}px`;
    });

    window.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Minimize toggle
    minimizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMinimize();
    });

    header.addEventListener('click', (e) => {
      if (isMinimized && !e.target.closest('.close-btn')) {
        toggleMinimize();
      }
    });

    // Close button
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeOverlay();
    });

    // Tab switching
    navTabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const targetTab = tab.getAttribute('data-tab');
        switchTab(targetTab);
      });
    });

    // Send task on Enter or Send click
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submitTask();
      }
    });

    sendBtn.addEventListener('click', () => {
      submitTask();
    });

    // Stop button
    stopBtn.addEventListener('click', () => {
      stopCurrentTask();
    });

    // Inspect refresh
    inspectRefreshBtn.addEventListener('click', () => {
      runDomInspect();
    });

    // Privacy preview
    runRedactionBtn.addEventListener('click', () => {
      runPrivacyPreview();
    });

    // Server test
    testServerBtn.addEventListener('click', () => {
      const url = (serverUrlInput.value || 'http://localhost:8000').trim().replace(/\/+$/, '');
      chrome.storage.local.set({ serverUrl: url });
      testServerConnection(url);
    });

    // Initial server test
    chrome.storage.local.get(['serverUrl'], (res) => {
      const url = res.serverUrl || 'http://localhost:8000';
      if (serverUrlInput) serverUrlInput.value = url;
      testServerConnection(url);
    });
  }

  function toggleMinimize() {
    const container = shadowRoot.getElementById('rakshakContainer');
    const navBar = shadowRoot.getElementById('navBar');
    const privacyBanner = shadowRoot.getElementById('privacyBanner');
    const overlayMain = shadowRoot.getElementById('overlayMain');
    const minimizeBtn = shadowRoot.getElementById('minimizeBtn');

    isMinimized = !isMinimized;
    if (isMinimized) {
      container.classList.add('minimized');
      navBar.style.display = 'none';
      privacyBanner.style.display = 'none';
      overlayMain.style.display = 'none';
      minimizeBtn.textContent = '□';
      minimizeBtn.title = 'Expand';
    } else {
      container.classList.remove('minimized');
      navBar.style.display = 'flex';
      privacyBanner.style.display = 'flex';
      overlayMain.style.display = 'flex';
      minimizeBtn.textContent = '—';
      minimizeBtn.title = 'Minimize';
    }
  }

  function closeOverlay() {
    if (currentState.isRunning) {
      stopCurrentTask();
    }
    const container = shadowRoot.getElementById('rakshakContainer');
    if (container) {
      container.classList.add('hidden');
    }
    chrome.storage.local.set({ overlayVisible: false });
  }

  function showOverlay() {
    const container = shadowRoot.getElementById('rakshakContainer');
    if (container) {
      container.classList.remove('hidden');
    }
    if (isMinimized) {
      toggleMinimize();
    }
    chrome.storage.local.set({ overlayVisible: true });
  }

  function switchTab(target) {
    const navTabs = shadowRoot.querySelectorAll('.nav-tab');
    const views = {
      chat: shadowRoot.getElementById('viewChat'),
      inspect: shadowRoot.getElementById('viewInspect'),
      privacy: shadowRoot.getElementById('viewPrivacy'),
      config: shadowRoot.getElementById('viewConfig')
    };

    navTabs.forEach(t => t.classList.toggle('active', t.getAttribute('data-tab') === target));
    Object.keys(views).forEach(k => {
      if (views[k]) {
        views[k].classList.toggle('hidden', k !== target);
      }
    });

    if (target === 'inspect') {
      runDomInspect();
    }
  }

  // ---------------------------------------------------------------------------
  // 4. SERVER CONNECTIVITY & TELEMETRY
  // ---------------------------------------------------------------------------
  function updateStatusIndicator(state, text) {
    const dot = shadowRoot.getElementById('headerStatusDot');
    const txt = shadowRoot.getElementById('headerStatusText');
    if (!dot || !txt) return;

    dot.className = `status-dot ${state}`;
    txt.textContent = text;
  }

  function safeSendMessage(message, callback) {
    if (!chrome?.runtime?.id) {
      console.warn('[Rakshak] Extension updated. Please refresh this webpage tab.');
      return;
    }
    try {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) {
          const err = chrome.runtime.lastError.message || '';
          if (err.includes('Extension context invalidated')) {
            console.warn('[Rakshak] Extension reloaded. Please refresh this webpage tab.');
            return;
          }
        }
        if (callback) callback(res);
      });
    } catch (e) {
      if (e.message?.includes('Extension context invalidated')) {
        console.warn('[Rakshak] Extension reloaded. Please refresh this webpage tab.');
      }
    }
  }

  function testServerConnection(url) {
    updateStatusIndicator('disconnected', 'Connecting...');
    safeSendMessage({ type: 'PING_SERVER', serverUrl: url }, (res) => {
      if (chrome.runtime.lastError || !res || !res.success) {
        updateStatusIndicator('disconnected', 'Offline');
        currentState.serverConnected = false;
        return;
      }

      currentState.serverConnected = true;
      currentState.serverTelemetry = res.data;
      updateStatusIndicator('connected', 'Connected');

      // Update telemetry cards in Config view
      const cfgLatency = shadowRoot.getElementById('cfgLatency');
      const cfgProvider = shadowRoot.getElementById('cfgProvider');
      const cfgHf = shadowRoot.getElementById('cfgHf');
      const cfgGemini = shadowRoot.getElementById('cfgGemini');

      if (cfgLatency) cfgLatency.textContent = `${res.latencyMs || 0} ms`;
      if (cfgProvider) cfgProvider.textContent = res.data.configured_provider || 'auto';
      if (cfgHf) cfgHf.textContent = res.data.hf_configured ? (res.data.hf_model || 'Ready') : 'Not Set';
      if (cfgGemini) cfgGemini.textContent = res.data.gemini_configured ? 'Ready' : 'Not Set';
    });
  }

  // ---------------------------------------------------------------------------
  // 5. TASK SUBMISSION & AGENT EXECUTION CONTROL
  // ---------------------------------------------------------------------------
  function submitTask() {
    const chatInput = shadowRoot.getElementById('chatInput');
    const task = chatInput.value.trim();
    if (!task || currentState.isRunning) return;

    chatInput.value = '';
    appendUserMessage(task);
    activeAgentMsgContainer = null;

    const serverUrlInput = shadowRoot.getElementById('serverUrlInput');
    const serverUrl = (serverUrlInput ? serverUrlInput.value.trim() : '') || currentState.serverUrl || 'http://localhost:8000';

    safeSendMessage({
      type: 'START_AGENT_TASK',
      task: task,
      maxSteps: 12,
      serverUrl: serverUrl
    }, (response) => {
      if (chrome.runtime.lastError || !response || !response.success) {
        appendAgentMessage(`Failed to start task: ${chrome.runtime.lastError?.message || response?.error || 'Unknown error'}`);
      }
    });
  }

  function stopCurrentTask() {
    safeSendMessage({ type: 'STOP_AGENT_TASK' }, (res) => {
      updateRunningUI(false);
    });
  }

  function updateRunningUI(isRunning, currentStep = 0, maxSteps = 12) {
    currentState.isRunning = isRunning;
    const sendBtn = shadowRoot.getElementById('sendBtn');
    const stopBtn = shadowRoot.getElementById('stopBtn');
    const chatInput = shadowRoot.getElementById('chatInput');
    const stepIndicator = shadowRoot.getElementById('stepIndicator');

    if (isRunning) {
      if (sendBtn) sendBtn.style.display = 'none';
      if (stopBtn) stopBtn.style.display = 'flex';
      if (chatInput) chatInput.disabled = true;
      if (stepIndicator) stepIndicator.textContent = `Running Step ${currentStep} / ${maxSteps}`;
      updateStatusIndicator('running', `Running (${currentStep}/${maxSteps})`);
    } else {
      if (sendBtn) sendBtn.style.display = 'flex';
      if (stopBtn) stopBtn.style.display = 'none';
      if (chatInput) chatInput.disabled = false;
      if (stepIndicator) stepIndicator.textContent = 'Ready';
      if (currentState.serverConnected) {
        updateStatusIndicator('connected', 'Connected');
      } else {
        updateStatusIndicator('disconnected', 'Offline');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 6. CHAT RENDERING & PROGRESS STEP MANAGEMENT
  // ---------------------------------------------------------------------------
  let activeAgentMsgContainer = null;

  function appendUserMessage(text) {
    const chatMessages = shadowRoot.getElementById('chatMessages');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg user-msg';
    msgDiv.innerHTML = `
      <div class="msg-bubble">
        <div class="msg-text">${escapeHtml(text)}</div>
      </div>
    `;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function appendAgentMessage(text) {
    const chatMessages = shadowRoot.getElementById('chatMessages');
    const msgDiv = document.createElement('div');
    msgDiv.className = 'chat-msg agent-msg';
    msgDiv.innerHTML = `
      <div class="msg-avatar">🛡️</div>
      <div class="msg-bubble">
        <div class="msg-sender">Rakshak Agent</div>
        <div class="msg-text">${escapeHtml(text)}</div>
      </div>
    `;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function getOrCreateAgentContainer(initialText) {
    if (activeAgentMsgContainer && activeAgentMsgContainer.msgDiv && activeAgentMsgContainer.msgDiv.isConnected) {
      return activeAgentMsgContainer;
    }

    const chatMessages = shadowRoot.getElementById('chatMessages');
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
    textEl.textContent = initialText || "I'll help with that.";

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
      detailsToggle.innerHTML = isHidden ? '<span>▾ Hide Details</span>' : '<span>▸ Technical Details</span>';
      chatMessages.scrollTop = chatMessages.scrollHeight;
    });

    bubble.appendChild(sender);
    bubble.appendChild(textEl);
    bubble.appendChild(progressBox);
    bubble.appendChild(detailsToggle);
    bubble.appendChild(detailsContent);

    msgDiv.appendChild(avatar);
    msgDiv.appendChild(bubble);

    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    activeAgentMsgContainer = {
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
        chatMessages.scrollTop = chatMessages.scrollHeight;
        return step;
      },
      addTechnicalDetail(data) {
        this.technicalLogs.push(data);
        this.detailsToggle.style.display = 'flex';
        this.detailsContent.textContent = JSON.stringify(this.technicalLogs, null, 2);
      }
    };

    return activeAgentMsgContainer;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---------------------------------------------------------------------------
  // 7. BACKGROUND STATE SYNCHRONIZATION
  // ---------------------------------------------------------------------------
  function syncWithBackgroundState() {
    safeSendMessage({ type: 'GET_AGENT_STATE' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.state) {
        return;
      }
      applyBackgroundState(response.state);
    });
  }

  function applyBackgroundState(state) {
    if (!state) return;
    currentState = { ...currentState, ...state };

    updateRunningUI(state.isRunning, state.currentStep, state.maxSteps);

    // Reconstruct steps if state has logs and we haven't rendered them yet
    if (state.logs && state.logs.length > 0) {
      const container = getOrCreateAgentContainer(state.task ? `Working on: "${state.task}"` : undefined);
      container.progressBox.innerHTML = '';
      state.logs.forEach((log) => {
        container.addProgressStep(log.icon || '✓', log.text || '', log.statusClass || 'done');
      });
      if (state.technicalLogs && state.technicalLogs.length > 0) {
        state.technicalLogs.forEach(t => container.addTechnicalDetail(t));
      }
    }

    if (state.finalMessage) {
      const container = getOrCreateAgentContainer();
      container.textEl.textContent = state.finalMessage;
    }
  }

  // Listen for real-time state broadcasts from service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'AGENT_STATE_UPDATED') {
      applyBackgroundState(message.state);
      sendResponse({ received: true });
      return true;
    }

    if (message.type === 'TOGGLE_OVERLAY') {
      const container = shadowRoot.getElementById('rakshakContainer');
      if (container.classList.contains('hidden')) {
        showOverlay();
      } else if (isMinimized) {
        toggleMinimize();
      } else {
        closeOverlay();
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'SHOW_OVERLAY') {
      showOverlay();
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'HIDE_OVERLAY_FOR_CAPTURE') {
      if (hostElement) {
        hostElement.style.opacity = '0';
        hostElement.style.visibility = 'hidden';
      }
      sendResponse({ success: true });
      return true;
    }

    if (message.type === 'RESTORE_OVERLAY_AFTER_CAPTURE') {
      if (hostElement) {
        hostElement.style.opacity = '1';
        hostElement.style.visibility = 'visible';
      }
      sendResponse({ success: true });
      return true;
    }
  });

  // ---------------------------------------------------------------------------
  // 8. DOM INSPECTION & PRIVACY PREVIEW HELPERS
  // ---------------------------------------------------------------------------
  function runDomInspect() {
    if (window.__rakshakContextCollector && typeof window.__rakshakContextCollector.collect === 'function') {
      const context = window.__rakshakContextCollector.collect();
      renderInspectResults(context);
    }
  }

  function renderInspectResults(context) {
    if (!context) return;
    const statTitle = shadowRoot.getElementById('statTitle');
    const statElements = shadowRoot.getElementById('statElements');
    const statSensitive = shadowRoot.getElementById('statSensitive');
    const elementsList = shadowRoot.getElementById('elementsList');

    if (statTitle) statTitle.textContent = context.page?.title ? (context.page.title.slice(0, 18) + '...') : 'Untitled';
    if (statElements) statElements.textContent = context.totalCount || 0;
    if (statSensitive) statSensitive.textContent = `${context.sensitiveCount || 0} Detected`;

    if (elementsList) {
      elementsList.innerHTML = '';
      (context.elements || []).slice(0, 25).forEach((el) => {
        const item = document.createElement('div');
        item.className = `el-item ${el.isSensitive ? 'sensitive' : ''}`;
        const sensBadge = el.isSensitive ? '🔒 ' : '';
        item.innerHTML = `
          <div><span style="color: #58a6ff; font-family: monospace;">[${el.tag}]</span> ${sensBadge}${escapeHtml(el.label || el.name || el.type || 'item')}</div>
          <span style="color: #8b949e; font-size: 9.5px;">(${el.boundingBox?.x || 0}, ${el.boundingBox?.y || 0})</span>
        `;
        elementsList.appendChild(item);
      });
    }
  }

  function runPrivacyPreview() {
    const previewBox = shadowRoot.getElementById('previewBox');
    const badge = shadowRoot.getElementById('redactedBadgeCount');
    if (previewBox) {
      previewBox.innerHTML = '<span style="color: #58a6ff; font-size: 11px;">Capturing & Redacting...</span>';
    }

    safeSendMessage({ type: 'CAPTURE_AND_REDACT_SCREEN' }, (res) => {
      if (chrome.runtime.lastError || !res || !res.success || !res.sanitizedImage) {
        if (previewBox) {
          previewBox.innerHTML = `<span style="color: #f85149; font-size: 11px;">Capture failed: ${escapeHtml(res?.error || chrome.runtime.lastError?.message || 'Error')}</span>`;
        }
        return;
      }

      if (previewBox) {
        previewBox.innerHTML = `<img src="${res.sanitizedImage}" alt="Sanitized Preview" />`;
      }
      if (badge) {
        badge.textContent = `${res.redactedCount || 0} REDACTIONS APPLIED`;
      }
    });
  }

  // ---------------------------------------------------------------------------
  // 9. BOOTSTRAP
  // ---------------------------------------------------------------------------
  function bootstrap() {
    // Check if user previously opened/closed overlay
    chrome.storage.local.get(['overlayVisible'], (res) => {
      // Default to visible on websites
      const shouldShow = res.overlayVisible !== false;
      initOverlay();
      if (!shouldShow) {
        closeOverlay();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
