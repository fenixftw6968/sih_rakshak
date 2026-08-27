/**
 * Rakshak Local Context Collector
 * Runs strictly within the browser tab runtime to extract visible interactive
 * elements, media playback status, labels, text content, and bounding boxes without transmitting anything.
 */

(function () {
  'use strict';

  function isElementVisible(el) {
    if (!el || !(el instanceof Element)) return false;

    // Check style properties
    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      style.pointerEvents === 'none'
    ) {
      return false;
    }

    // Check DOM geometry
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return false;
    }

    // Check viewport bounds (allow slightly out-of-bounds if partially visible)
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

    const inViewport = (
      rect.top < viewportHeight &&
      rect.bottom > 0 &&
      rect.left < viewportWidth &&
      rect.right > 0
    );

    return inViewport;
  }

  function getElementLabel(el) {
    if (!el) return '';

    // 1. Check aria-label
    if (el.getAttribute('aria-label')) {
      return el.getAttribute('aria-label').trim();
    }

    // 2. Check aria-labelledby
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl && labelEl.innerText) {
        return labelEl.innerText.trim();
      }
    }

    // 3. Check associated <label> for inputs
    if (el.id) {
      const labelEl = document.querySelector(`label[for="${el.id}"]`);
      if (labelEl && labelEl.innerText) {
        return labelEl.innerText.trim();
      }
    }

    // Check closest wrapping <label>
    const parentLabel = el.closest('label');
    if (parentLabel && parentLabel.innerText) {
      // Return label text excluding element's own value
      return parentLabel.innerText.replace(el.value || '', '').trim();
    }

    // 4. Check placeholder or title attribute
    if (el.placeholder) return el.placeholder.trim();
    if (el.title) return el.title.trim();

    // 5. Check innerText for buttons, links, etc.
    if (el.innerText && el.innerText.trim().length > 0) {
      return el.innerText.trim().slice(0, 150); // limit length
    }

    // 6. Check value attribute for submit/button inputs
    if (el.value && (el.type === 'button' || el.type === 'submit')) {
      return el.value.trim();
    }

    // 7. Check name attribute
    if (el.name) return el.name.trim();

    return '';
  }

  function getCssSelector(el) {
    if (!el || !(el instanceof Element)) return '';
    if (el.id) return `#${el.id}`;

    let path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.nodeName.toLowerCase();
      if (el.id) {
        selector += `#${el.id}`;
        path.unshift(selector);
        break;
      } else {
        let sib = el, nth = 1;
        while ((sib = sib.previousElementSibling)) {
          if (sib.nodeName.toLowerCase() === selector) nth++;
        }
        if (nth !== 1) selector += `:nth-of-type(${nth})`;
      }
      path.unshift(selector);
      el = el.parentElement;
    }
    return path.join(' > ');
  }

  /**
   * Evaluates active media elements and playback state on the current page.
   */
  function inspectPageMediaState() {
    const mediaElements = Array.from(document.querySelectorAll('video, audio'));
    let isAnyPlaying = false;
    let activeMediaInfo = null;

    for (const m of mediaElements) {
      const isPlaying = !!(m.currentTime > 0 && !m.paused && !m.ended && m.readyState > 2);
      if (isPlaying) {
        isAnyPlaying = true;
        activeMediaInfo = {
          tag: m.tagName.toLowerCase(),
          currentTime: Math.round(m.currentTime),
          duration: Math.round(m.duration || 0),
          paused: false,
          muted: m.muted || false
        };
        break;
      }
    }

    // Check for YouTube / generic media player playback state if HTML5 video state is protected
    if (!isAnyPlaying) {
      const ytPlayer = document.querySelector('.html5-video-player, ytd-player');
      if (ytPlayer && ytPlayer.classList.contains('playing-mode')) {
        isAnyPlaying = true;
        activeMediaInfo = { tag: 'video', isYouTubePlaying: true, paused: false };
      }
    }

    return {
      hasMedia: mediaElements.length > 0,
      isPlaying: isAnyPlaying,
      activeMedia: activeMediaInfo
    };
  }

  function collectLocalPageContext() {
    const mediaState = inspectPageMediaState();

    const pageInfo = {
      title: document.title || '',
      url: window.location.href,
      mediaState: mediaState,
      viewport: {
        width: window.innerWidth || document.documentElement.clientWidth,
        height: window.innerHeight || document.documentElement.clientHeight,
        scrollX: window.scrollX || window.pageXOffset,
        scrollY: window.scrollY || window.pageYOffset
      },
      collectedAt: Date.now()
    };

    const interactiveSelectors = [
      'button',
      'input',
      'select',
      'textarea',
      'a[href]',
      'video',
      'audio',
      '[role="button"]',
      '[role="link"]',
      '[role="checkbox"]',
      '[role="textbox"]',
      '[tabindex]:not([tabindex="-1"])',
      'form',
      'ytd-video-renderer a#thumbnail',
      'ytd-video-renderer a#video-title'
    ].join(', ');

    const candidateElements = Array.from(document.querySelectorAll(interactiveSelectors));
    const elements = [];
    let elementIdCounter = 1;

    for (const el of candidateElements) {
      if (!isElementVisible(el)) {
        continue;
      }

      const rect = el.getBoundingClientRect();
      const label = getElementLabel(el);
      const tag = el.tagName.toLowerCase();
      const inputType = el.getAttribute('type') || (tag === 'input' ? 'text' : null);

      // Store a local identifier on the DOM element for fast referencing later
      const localId = `rakshak-el-${elementIdCounter++}`;
      el.setAttribute('data-rakshak-id', localId);

      elements.push({
        id: localId,
        tag: tag,
        type: inputType,
        name: el.name || null,
        label: label,
        value: (tag === 'input' || tag === 'textarea' || tag === 'select') ? (el.value || '') : null,
        placeholder: el.placeholder || null,
        disabled: el.disabled || false,
        readOnly: el.readOnly || false,
        selector: getCssSelector(el),
        boundingBox: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        isInteractive: true
      });
    }

    const result = {
      page: pageInfo,
      elements: elements,
      mediaState: mediaState,
      totalCount: elements.length,
      sensitiveCount: 0,
      transmitted: false // Strict local-only metadata
    };

    // Run local privacy scan if detector is loaded
    if (typeof window !== 'undefined' && window.__rakshakPIIDetector) {
      const scan = window.__rakshakPIIDetector.scanContextForPII(result);
      result.sensitiveCount = scan.totalSensitiveCount;
      result.sensitiveElements = scan.sensitiveElements;
    }

    return result;
  }

  // Export for usage in window and module environments
  if (typeof window !== 'undefined') {
    window.__rakshakContextCollector = {
      collect: collectLocalPageContext,
      isElementVisible: isElementVisible,
      getElementLabel: getElementLabel,
      inspectPageMediaState: inspectPageMediaState
    };

    // Listen for requests from popup/background
    chrome?.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
      if (message.type === 'COLLECT_LOCAL_CONTEXT') {
        const context = collectLocalPageContext();
        sendResponse({ success: true, context: context });
        return true;
      }

      if (message.type === 'PERFORM_VISUAL_REDACTION') {
        const context = collectLocalPageContext();
        const sensitiveElements = context.sensitiveElements || [];
        const dpr = window.devicePixelRatio || 1;

        if (window.__rakshakVisualRedactor) {
          window.__rakshakVisualRedactor
            .redactScreenImage(message.rawScreenshot, sensitiveElements, dpr)
            .then((sanitizedImage) => {
              sendResponse({
                success: true,
                sanitizedImage: sanitizedImage,
                redactedCount: sensitiveElements.length
              });
            })
            .catch((err) => {
              sendResponse({ success: false, error: err.message });
            });
        } else {
          sendResponse({ success: false, error: 'Visual redactor module not initialized' });
        }
        return true;
      }
    });
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      collectLocalPageContext,
      isElementVisible,
      getElementLabel,
      getCssSelector,
      inspectPageMediaState
    };
  }
})();
