/**
 * Rakshak Safe Local Action Validator and Executor
 * Validates all AI decisions locally before executing declarative DOM actions.
 * Dispatches realistic browser events for modern web apps (YouTube, React, etc.)
 * Strictly prohibits arbitrary JavaScript execution.
 */

(function () {
  'use strict';

  const ALLOWED_ACTIONS = new Set(['CLICK', 'TYPE', 'KEY', 'SCROLL', 'WAIT', 'STOP', 'PLAY']);
  const ALLOWED_KEYS = new Set(['ENTER', 'ESCAPE', 'TAB', 'ARROWDOWN', 'ARROWUP', 'SPACE']);

  /**
   * Helper: Locates an element in the DOM using data-rakshak-id, ID, or CSS selector.
   */
  function findElement(target) {
    if (!target) return null;

    // 1. Try by data-rakshak-id attribute
    if (target.elementId) {
      const byRakshakId = document.querySelector(`[data-rakshak-id="${target.elementId}"]`);
      if (byRakshakId) return byRakshakId;

      // Also try standard ID match
      const byId = document.getElementById(target.elementId);
      if (byId) return byId;
    }

    // 2. Try by CSS selector
    if (target.selector && typeof target.selector === 'string') {
      try {
        const bySelector = document.querySelector(target.selector);
        if (bySelector) return bySelector;
      } catch (e) {
        console.warn('[Rakshak Executor] Invalid CSS selector:', target.selector);
      }
    }

    return null;
  }

  /**
   * Helper: Checks whether element is connected to DOM and visible.
   */
  function isElementInteractable(el) {
    if (!el || !(el instanceof Element)) return false;
    if (!el.isConnected) return false;
    if (typeof el.closest === 'function' && (el.closest('#rakshak-agent-overlay-root') || el.closest('[data-rakshak-overlay]'))) return false;
    if (el.id === 'rakshak-agent-overlay-root') return false;
    if (typeof el.hasAttribute === 'function' && el.hasAttribute('data-rakshak-overlay')) return false;
    if (typeof el.getAttribute === 'function' && el.getAttribute('data-rakshak-overlay')) return false;

    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      style.pointerEvents === 'none'
    ) {
      return false;
    }

    return true;
  }

  /**
   * Validates an AI browser action against strict local safety rules.
   * @param {Object} actionObj
   * @returns {{ valid: boolean, error?: string, element?: Element }}
   */
  function validateAction(actionObj) {
    if (!actionObj || typeof actionObj !== 'object') {
      return { valid: false, error: 'Action payload must be a non-null JSON object' };
    }

    const actionType = String(actionObj.action || '').toUpperCase();
    if (!ALLOWED_ACTIONS.has(actionType)) {
      return {
        valid: false,
        error: `Action '${actionObj.action}' is not permitted. Allowed actions: ${Array.from(ALLOWED_ACTIONS).join(', ')}`
      };
    }

    // STOP and WAIT actions require no target element
    if (actionType === 'STOP') {
      return { valid: true, actionType: 'STOP' };
    }

    if (actionType === 'WAIT') {
      const duration = Number(actionObj.duration || actionObj.value || 1000);
      if (isNaN(duration) || duration < 0 || duration > 10000) {
        return { valid: false, error: 'WAIT duration must be between 0 and 10000 ms' };
      }
      return { valid: true, actionType: 'WAIT', duration };
    }

    // PLAY action validation (maps safely to video/audio control or play button)
    if (actionType === 'PLAY') {
      let el = null;
      if (actionObj.target && (actionObj.target.elementId || actionObj.target.selector)) {
        el = findElement(actionObj.target);
      } else {
        el = document.querySelector('video, audio, [aria-label*="Play" i], [title*="Play" i], .play-btn');
      }
      return { valid: true, actionType: 'PLAY', element: el };
    }

    // KEY action validation
    if (actionType === 'KEY') {
      const keyName = String(actionObj.key || actionObj.value || '').toUpperCase();
      if (!ALLOWED_KEYS.has(keyName)) {
        return {
          valid: false,
          error: `Key '${keyName}' is not permitted. Allowed keys: ${Array.from(ALLOWED_KEYS).join(', ')}`
        };
      }
      // If target provided, validate it; otherwise key can be dispatched to currently active element
      let el = null;
      if (actionObj.target && (actionObj.target.elementId || actionObj.target.selector)) {
        el = findElement(actionObj.target);
        if (!el || !isElementInteractable(el)) {
          return { valid: false, error: `Target element for KEY '${keyName}' not found or not interactable` };
        }
      }
      return { valid: true, actionType: 'KEY', keyName, element: el };
    }

    // SCROLL action validation
    if (actionType === 'SCROLL') {
      let el = null;
      if (actionObj.target && (actionObj.target.elementId || actionObj.target.selector)) {
        el = findElement(actionObj.target);
      }
      return { valid: true, actionType: 'SCROLL', element: el };
    }

    // Target required for CLICK and TYPE
    const target = actionObj.target;
    if (!target || (!target.elementId && !target.selector)) {
      return { valid: false, error: `Action '${actionType}' requires a valid target elementId or selector` };
    }

    const el = findElement(target);
    if (!el) {
      return {
        valid: false,
        error: `Target element not found in DOM (id: '${target.elementId || 'none'}', selector: '${target.selector || 'none'}')`
      };
    }

    if (!isElementInteractable(el)) {
      return {
        valid: false,
        error: `Target element found in DOM but is hidden or not interactable (tag: ${el.tagName})`
      };
    }

    if (actionType === 'TYPE') {
      if (typeof actionObj.value !== 'string') {
        return { valid: false, error: "TYPE action requires a string 'value' property" };
      }
      // Ensure element accepts text input
      const tag = el.tagName.toLowerCase();
      const isInput = tag === 'input' || tag === 'textarea' || el.isContentEditable || el.getAttribute('role') === 'textbox';
      if (!isInput) {
        return { valid: false, error: `Cannot TYPE into non-text element <${tag}>` };
      }
    }

    return { valid: true, actionType, element: el };
  }

  /**
   * Helper: Dispatches keyboard events safely.
   */
  function dispatchKeyEvents(targetEl, keyName) {
    const keyMap = {
      ENTER: { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 },
      ESCAPE: { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 },
      TAB: { key: 'Tab', code: 'Tab', keyCode: 9, which: 9 },
      ARROWDOWN: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 },
      ARROWUP: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 38, which: 38 },
      SPACE: { key: ' ', code: 'Space', keyCode: 32, which: 32 }
    };

    const keyInfo = keyMap[keyName] || { key: keyName, code: keyName, keyCode: 0, which: 0 };
    const eventOptions = {
      key: keyInfo.key,
      code: keyInfo.code,
      keyCode: keyInfo.keyCode,
      which: keyInfo.which,
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window
    };

    targetEl.dispatchEvent(new KeyboardEvent('keydown', eventOptions));
    targetEl.dispatchEvent(new KeyboardEvent('keypress', eventOptions));
    targetEl.dispatchEvent(new KeyboardEvent('keyup', eventOptions));

    // If Enter key on form input or form itself, also check for form submission
    if (keyName === 'ENTER') {
      if (targetEl.form) {
        try {
          const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
          targetEl.form.dispatchEvent(submitEvent);
        } catch (e) {
          // Form dispatch fallback
        }
      }
    }
  }

  /**
   * Safe Local Action Executor
   * Executes verified browser actions using native DOM events.
   * @param {Object} actionObj
   * @returns {Promise<{ success: boolean, action: string, message: string, details?: any }>}
   */
  async function executeAction(actionObj) {
    const validation = validateAction(actionObj);
    if (!validation.valid) {
      return {
        success: false,
        action: actionObj?.action || 'UNKNOWN',
        message: `Validation Failed: ${validation.error}`
      };
    }

    const actionType = validation.actionType;

    try {
      // 1. STOP Action
      if (actionType === 'STOP') {
        return {
          success: true,
          action: 'STOP',
          message: actionObj.reason || 'Task finished by AI decision'
        };
      }

      // 2. WAIT Action
      if (actionType === 'WAIT') {
        const ms = validation.duration || 1000;
        await new Promise((resolve) => setTimeout(resolve, ms));
        return {
          success: true,
          action: 'WAIT',
          message: `Waited for ${ms}ms`
        };
      }

      // 3. SCROLL Action
      if (actionType === 'SCROLL') {
        const el = validation.element;
        const direction = String(actionObj.direction || actionObj.value || 'down').toLowerCase();
        const scrollAmount = Math.min(Math.max(Number(actionObj.amount) || 400, 50), 1000);

        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        } else if (direction === 'up') {
          window.scrollBy({ top: -scrollAmount, left: 0, behavior: 'smooth' });
        } else {
          window.scrollBy({ top: scrollAmount, left: 0, behavior: 'smooth' });
        }

        await new Promise((r) => setTimeout(r, 200));
        return {
          success: true,
          action: 'SCROLL',
          message: `Scrolled ${el ? 'to element' : direction}`
        };
      }

      // 4. KEY Action
      if (actionType === 'KEY') {
        const targetEl = validation.element || document.activeElement || document.body;
        if (targetEl && typeof targetEl.focus === 'function') {
          targetEl.focus();
        }

        dispatchKeyEvents(targetEl, validation.keyName);

        return {
          success: true,
          action: 'KEY',
          message: `Pressed key '${validation.keyName}' successfully`
        };
      }

      // 5. TYPE Action
      if (actionType === 'TYPE') {
        const el = validation.element;
        const textToType = String(actionObj.value || '');

        // Scroll into view & focus
        el.scrollIntoView({ behavior: 'auto', block: 'nearest' });
        el.focus();

        // Safe value setting compatible with YouTube / React / Angular / Vanilla
        if (el.tagName.toLowerCase() === 'input' || el.tagName.toLowerCase() === 'textarea') {
          const proto = (el.tagName.toUpperCase() === 'INPUT' ? window.HTMLInputElement : window.HTMLTextAreaElement)?.prototype;
          const nativeInputValueSetter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : null;

          if (nativeInputValueSetter) {
            nativeInputValueSetter.call(el, textToType);
          } else {
            el.value = textToType;
          }
        } else if (el.isContentEditable) {
          el.textContent = textToType;
        }

        // Dispatch comprehensive input events for modern web apps
        el.dispatchEvent(new Event('focus', { bubbles: true }));
        el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));

        // If a key (e.g. ENTER) was attached with the TYPE action, dispatch it immediately
        let keyDispatched = null;
        if (actionObj.key) {
          const keyUpper = String(actionObj.key).toUpperCase();
          if (ALLOWED_KEYS.has(keyUpper)) {
            dispatchKeyEvents(el, keyUpper);
            keyDispatched = keyUpper;
          }
        }

        // Verification check
        const currentVal = el.value !== undefined ? el.value : el.textContent;
        const verified = currentVal === textToType || currentVal.includes(textToType);

        return {
          success: true,
          action: 'TYPE',
          message: `Typed "${textToType}" successfully (Verified: ${verified ? 'YES' : 'NO'}${keyDispatched ? `, Key: ${keyDispatched}` : ''})`,
          details: { verified, targetTag: el.tagName, keyDispatched }
        };
      }

      // 6. CLICK Action
      if (actionType === 'CLICK') {
        const el = validation.element;

        // Scroll into view & focus
        el.scrollIntoView({ behavior: 'auto', block: 'nearest' });
        if (typeof el.focus === 'function') {
          el.focus();
        }

        const rect = el.getBoundingClientRect();
        const clientX = rect.left + rect.width / 2;
        const clientY = rect.top + rect.height / 2;

        const mouseOpts = {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX: clientX,
          clientY: clientY
        };

        // Dispatch realistic sequence of mouse events
        el.dispatchEvent(new MouseEvent('pointerdown', mouseOpts));
        el.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
        el.dispatchEvent(new MouseEvent('pointerup', mouseOpts));
        el.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
        el.dispatchEvent(new MouseEvent('click', mouseOpts));

        // Call native .click() as backup if not triggered by event
        if (typeof el.click === 'function') {
          el.click();
        }

        // If element is inside an anchor tag, trigger anchor click for SPA navigation
        const anchor = (el.tagName === 'A' ? el : (typeof el.closest === 'function' ? el.closest('a') : null));
        if (anchor) {
          if (typeof anchor.click === 'function' && anchor !== el) {
            anchor.click();
          }

          if (anchor.href && (anchor.href.startsWith('http://') || anchor.href.startsWith('https://'))) {
            const currentUrl = window.location.href;
            const targetUrl = anchor.href;
            if (targetUrl !== currentUrl && !targetUrl.endsWith('#')) {
              setTimeout(() => {
                if (window.location.href === currentUrl) {
                  window.location.href = targetUrl;
                }
              }, 120);
            }
          }
        }

        return {
          success: true,
          action: 'CLICK',
          message: `Clicked element <${el.tagName.toLowerCase()}> successfully`
        };
      }

      // 7. PLAY Action (safely triggers video/media playback or play controls)
      if (actionType === 'PLAY') {
        const el = validation.element || document.querySelector('video, audio');
        if (el) {
          if (typeof el.play === 'function') {
            try {
              const playPromise = el.play();
              if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch((e) => console.warn('[Rakshak Play] Autoplay note:', e));
              }
            } catch (e) {
              console.warn('[Rakshak Play] Direct play error:', e);
            }
          }
          if (typeof el.click === 'function') {
            el.click();
          }
          return {
            success: true,
            action: 'PLAY',
            message: `Triggered media playback on <${el.tagName.toLowerCase()}>`
          };
        }

        // Fallback: look for play button
        const playBtn = document.querySelector('button[aria-label*="Play" i], button[title*="Play" i], .ytp-play-button');
        if (playBtn) {
          playBtn.click();
          return {
            success: true,
            action: 'PLAY',
            message: 'Clicked visible media play button'
          };
        }

        return {
          success: true,
          action: 'PLAY',
          message: 'Play command processed'
        };
      }

      return {
        success: false,
        action: actionType,
        message: `Unhandled action type: ${actionType}`
      };
    } catch (execErr) {
      return {
        success: false,
        action: actionType,
        message: `Execution Error: ${execErr.message}`
      };
    }
  }

  // Runtime message listener
  if (typeof window !== 'undefined') {
    window.__rakshakActionExecutor = {
      validateAction,
      executeAction,
      findElement,
      isElementInteractable,
      ALLOWED_ACTIONS,
      ALLOWED_KEYS
    };

    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'VALIDATE_LOCAL_ACTION') {
          const res = validateAction(message.action);
          sendResponse(res);
          return true;
        }

        if (message.type === 'EXECUTE_LOCAL_ACTION') {
          executeAction(message.action)
            .then((result) => sendResponse(result))
            .catch((err) => sendResponse({ success: false, message: err.message }));
          return true;
        }
      });
    }
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      validateAction,
      executeAction,
      findElement,
      isElementInteractable,
      ALLOWED_ACTIONS,
      ALLOWED_KEYS
    };
  }
})();
