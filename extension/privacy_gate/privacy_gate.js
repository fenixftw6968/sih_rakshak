/**
 * Rakshak Network Privacy Gate
 * The single unbypassable gateway through which all outgoing context payloads
 * must pass before transmission to any external or server-side AI model.
 */

(function () {
  'use strict';

  const ALLOWED_TOP_LEVEL_KEYS = new Set([
    'task',
    'page',
    'elements',
    'sanitizedImage',
    'clientId',
    'timestamp',
    'stepHistory',
    'currentStep',
    'maxSteps'
  ]);

  const ALLOWED_ELEMENT_KEYS = new Set([
    'id',
    'tag',
    'type',
    'label',
    'value',
    'placeholder',
    'boundingBox',
    'isInteractive',
    'disabled',
    'readOnly',
    'selector',
    'isSensitive',
    'sensitiveDetections'
  ]);

  const STRING_REPLACEMENTS = [
    {
      pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
      replacement: '[REDACTED_EMAIL]'
    },
    {
      pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
      replacement: '[REDACTED_SSN_ID]'
    },
    {
      pattern: /\b(?:\d{4}[-\s]?){3}\d{4}\b|\b\d{13,19}\b/g,
      replacement: '[REDACTED_CREDIT_CARD]'
    },
    {
      pattern: /(?:(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}\b)/g,
      replacement: '[REDACTED_PHONE]'
    },
    {
      pattern: /\b(?:password|pass|pwd)\s*(?:is|=|:)?\s*([a-zA-Z0-9!@#$%^&*()_+=-]{6,})\b/gi,
      replacement: 'password [REDACTED_PASSWORD]'
    },
    {
      pattern: /\b(?:bearer\s+[a-zA-Z0-9_\-\.]{20,}|ghp_[a-zA-Z0-9]{36}|sk-[a-zA-Z0-9]{32,})\b/gi,
      replacement: '[REDACTED_AUTH_TOKEN]'
    }
  ];

  function sanitizeString(str) {
    if (typeof str !== 'string') return str;
    let sanitized = str;
    for (const rule of STRING_REPLACEMENTS) {
      sanitized = sanitized.replace(rule.pattern, rule.replacement);
    }
    return sanitized;
  }

  /**
   * Validates and sanitizes payload before network transmission.
   * Strips unauthorized fields, enforces zero PII/credentials leakage.
   * @param {Object} payload
   * @returns {{ sanitizedPayload: Object, auditLog: Object, isClean: boolean }}
   */
  function validateAndSanitizePayload(payload) {
    if (!payload || typeof payload !== 'object') {
      throw new Error('Privacy Gate Violation: Outgoing payload must be a valid JSON object');
    }

    const auditLog = {
      timestamp: Date.now(),
      violationsDetected: 0,
      modifications: []
    };

    const sanitizedPayload = {};

    // 1. Enforce Top-Level Field Whitelist
    for (const key of Object.keys(payload)) {
      if (!ALLOWED_TOP_LEVEL_KEYS.has(key)) {
        auditLog.violationsDetected++;
        auditLog.modifications.push(`Stripped non-whitelisted root key: '${key}'`);
        continue;
      }
      sanitizedPayload[key] = payload[key];
    }

    // 2. Validate & Sanitize Page metadata
    if (sanitizedPayload.page && typeof sanitizedPayload.page === 'object') {
      sanitizedPayload.page = {
        title: sanitizeString(sanitizedPayload.page.title || ''),
        url: sanitizeString(sanitizedPayload.page.url || ''),
        viewport: sanitizedPayload.page.viewport || null,
        mediaState: sanitizedPayload.page.mediaState || null
      };
    }

    // 3. Validate & Sanitize Task prompt
    if (sanitizedPayload.task) {
      sanitizedPayload.task = sanitizeString(String(sanitizedPayload.task));
    }

    // 4. Validate & Sanitize Elements
    if (Array.isArray(sanitizedPayload.elements)) {
      const cleanElements = [];

      for (const el of sanitizedPayload.elements) {
        if (!el || typeof el !== 'object') continue;

        const cleanEl = {};
        for (const elKey of Object.keys(el)) {
          if (ALLOWED_ELEMENT_KEYS.has(elKey)) {
            cleanEl[elKey] = el[elKey];
          }
        }

        // Sensitive / Password Check: Never allow raw password values
        const isPassword = (
          cleanEl.type === 'password' ||
          (cleanEl.label && /password|passcode|pin|pwd|secret/i.test(cleanEl.label)) ||
          (cleanEl.name && /password|passcode|pin|pwd|secret/i.test(cleanEl.name))
        );

        if (isPassword) {
          if (cleanEl.value && cleanEl.value.length > 0 && cleanEl.value !== '[REDACTED_PASSWORD]') {
            auditLog.violationsDetected++;
            auditLog.modifications.push(`Sanitized raw password in element ID: ${cleanEl.id}`);
            cleanEl.value = '[REDACTED_PASSWORD]';
          }
          cleanEl.isSensitive = true;
        } else if (cleanEl.value) {
          const originalVal = String(cleanEl.value);
          const sanitizedVal = sanitizeString(originalVal);
          if (sanitizedVal !== originalVal) {
            auditLog.violationsDetected++;
            auditLog.modifications.push(`Sanitized PII in value of element ID: ${cleanEl.id}`);
            cleanEl.value = sanitizedVal;
            cleanEl.isSensitive = true;
          }
        }

        // Sanitize labels and placeholders
        if (cleanEl.label) cleanEl.label = sanitizeString(cleanEl.label);
        if (cleanEl.placeholder) cleanEl.placeholder = sanitizeString(cleanEl.placeholder);

        cleanElements.push(cleanEl);
      }

      sanitizedPayload.elements = cleanElements;
    }

    // 5. Final Safety Verification: Stringify and scan entire payload for dangerous unmasked patterns
    const serialized = JSON.stringify(sanitizedPayload);
    if (/password\s*[:=]\s*["'](?!\[REDACTED_PASSWORD\])[^"']{2,}["']/i.test(serialized)) {
      throw new Error('Privacy Gate Critical Block: Raw password leakage detected in payload string');
    }

    return {
      sanitizedPayload,
      auditLog,
      isClean: auditLog.violationsDetected === 0
    };
  }

  // Export
  if (typeof window !== 'undefined') {
    window.__rakshakPrivacyGate = {
      validateAndSanitizePayload,
      sanitizeString
    };
  }

  if (typeof self !== 'undefined') {
    self.__rakshakPrivacyGate = {
      validateAndSanitizePayload,
      sanitizeString
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      validateAndSanitizePayload,
      sanitizeString,
      ALLOWED_TOP_LEVEL_KEYS,
      ALLOWED_ELEMENT_KEYS
    };
  }
})();
