/**
 * Rakshak Local Privacy and PII Detection Engine
 * Detects sensitive DOM elements, passwords, emails, phones, credit cards,
 * national IDs, and auth tokens locally using multi-tier heuristics.
 */

(function () {
  'use strict';

  const SENSITIVITY_TYPES = {
    PASSWORD: 'PASSWORD',
    EMAIL: 'EMAIL',
    PHONE: 'PHONE',
    CREDIT_CARD: 'CREDIT_CARD',
    SSN_ID: 'SSN_ID',
    AUTH_TOKEN: 'AUTH_TOKEN',
    FINANCIAL: 'FINANCIAL',
    GENERIC_SENSITIVE: 'GENERIC_SENSITIVE'
  };

  const REDACTION_STRATEGIES = {
    MASK: 'MASK',
    BLACKOUT: 'BLACKOUT',
    REPLACE_TOKEN: 'REPLACE_TOKEN'
  };

  // Regex patterns
  const PATTERNS = {
    EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    PHONE: /(?:(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}\b)/g,
    SSN: /\b\d{3}-\d{2}-\d{4}\b/g,
    CREDIT_CARD: /\b(?:\d{4}[-\s]?){3}\d{4}\b|\b\d{13,19}\b/g,
    AUTH_TOKEN: /\b(?:bearer\s+[a-zA-Z0-9_\-\.]{20,}|ghp_[a-zA-Z0-9]{36}|sk-[a-zA-Z0-9]{32,})\b/gi
  };

  const SENSITIVE_KEYWORDS = {
    PASSWORD: ['password', 'passcode', 'pwd', 'pin', 'secret', 'passphrase', 'current-password', 'new-password'],
    EMAIL: ['email', 'e-mail', 'mail_address'],
    PHONE: ['phone', 'telephone', 'mobile', 'cell', 'contact_no', 'contact_number'],
    CREDIT_CARD: ['creditcard', 'credit_card', 'cc_num', 'card_number', 'cardnumber', 'cvv', 'cvc', 'exp_date', 'expiration'],
    SSN_ID: ['ssn', 'social_security', 'social security', 'national_id', 'aadhaar', 'tax_id', 'passport'],
    FINANCIAL: ['salary', 'income', 'bank_account', 'account_number', 'routing_number', 'iban']
  };

  // Luhn algorithm for valid credit card numbers
  function validateLuhn(ccNumber) {
    const cleaned = ccNumber.replace(/[\s-]/g, '');
    if (!/^\d{13,19}$/.test(cleaned)) return false;
    let sum = 0;
    let shouldDouble = false;
    for (let i = cleaned.length - 1; i >= 0; i--) {
      let digit = parseInt(cleaned.charAt(i), 10);
      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      sum += digit;
      shouldDouble = !shouldDouble;
    }
    return sum % 10 === 0;
  }

  function detectElementSensitivity(elementData) {
    const detections = [];
    if (!elementData) return detections;

    const tag = (elementData.tag || '').toLowerCase();
    const type = (elementData.type || '').toLowerCase();
    const name = (elementData.name || '').toLowerCase();
    const label = (elementData.label || '').toLowerCase();
    const placeholder = (elementData.placeholder || '').toLowerCase();
    const value = String(elementData.value || '');
    const combinedContext = `${name} ${label} ${placeholder}`.toLowerCase();

    // 1. Password & Auth Check (Highest Priority - 100% confidence)
    if (type === 'password') {
      detections.push({
        type: SENSITIVITY_TYPES.PASSWORD,
        confidence: 1.0,
        strategy: REDACTION_STRATEGIES.MASK,
        reason: 'HTML input type=password',
        elementId: elementData.id
      });
      return detections;
    }

    for (const kw of SENSITIVE_KEYWORDS.PASSWORD) {
      if (combinedContext.includes(kw)) {
        detections.push({
          type: SENSITIVITY_TYPES.PASSWORD,
          confidence: 0.95,
          strategy: REDACTION_STRATEGIES.MASK,
          reason: `Password keyword '${kw}' in element context`,
          elementId: elementData.id
        });
        return detections;
      }
    }

    // 2. SSN / National ID Check
    for (const kw of SENSITIVE_KEYWORDS.SSN_ID) {
      if (combinedContext.includes(kw)) {
        detections.push({
          type: SENSITIVITY_TYPES.SSN_ID,
          confidence: 0.95,
          strategy: REDACTION_STRATEGIES.MASK,
          reason: `National ID keyword '${kw}' in element context`,
          elementId: elementData.id
        });
        return detections;
      }
    }
    if (value && PATTERNS.SSN.test(value)) {
      detections.push({
        type: SENSITIVITY_TYPES.SSN_ID,
        confidence: 0.98,
        strategy: REDACTION_STRATEGIES.MASK,
        reason: 'Pattern match for SSN format (XXX-XX-XXXX)',
        elementId: elementData.id
      });
      return detections;
    }

    // 3. Credit Card Check
    for (const kw of SENSITIVE_KEYWORDS.CREDIT_CARD) {
      if (combinedContext.includes(kw)) {
        detections.push({
          type: SENSITIVITY_TYPES.CREDIT_CARD,
          confidence: 0.92,
          strategy: REDACTION_STRATEGIES.MASK,
          reason: `Payment/Card keyword '${kw}' in element context`,
          elementId: elementData.id
        });
        return detections;
      }
    }
    if (value && validateLuhn(value)) {
      detections.push({
        type: SENSITIVITY_TYPES.CREDIT_CARD,
        confidence: 0.99,
        strategy: REDACTION_STRATEGIES.MASK,
        reason: 'Valid Luhn credit card number pattern',
        elementId: elementData.id
      });
      return detections;
    }

    // 4. Email Check
    if (type === 'email') {
      detections.push({
        type: SENSITIVITY_TYPES.EMAIL,
        confidence: 0.99,
        strategy: REDACTION_STRATEGIES.MASK,
        reason: 'HTML input type=email',
        elementId: elementData.id
      });
      return detections;
    }
    for (const kw of SENSITIVE_KEYWORDS.EMAIL) {
      if (combinedContext.includes(kw)) {
        detections.push({
          type: SENSITIVITY_TYPES.EMAIL,
          confidence: 0.90,
          strategy: REDACTION_STRATEGIES.MASK,
          reason: `Email keyword '${kw}' in context`,
          elementId: elementData.id
        });
        return detections;
      }
    }
    if (value && PATTERNS.EMAIL.test(value)) {
      detections.push({
        type: SENSITIVITY_TYPES.EMAIL,
        confidence: 0.98,
        strategy: REDACTION_STRATEGIES.MASK,
        reason: 'Email regex pattern match',
        elementId: elementData.id
      });
      return detections;
    }

    // 5. Phone Check
    if (type === 'tel') {
      detections.push({
        type: SENSITIVITY_TYPES.PHONE,
        confidence: 0.99,
        strategy: REDACTION_STRATEGIES.MASK,
        reason: 'HTML input type=tel',
        elementId: elementData.id
      });
      return detections;
    }
    for (const kw of SENSITIVE_KEYWORDS.PHONE) {
      if (combinedContext.includes(kw)) {
        detections.push({
          type: SENSITIVITY_TYPES.PHONE,
          confidence: 0.88,
          strategy: REDACTION_STRATEGIES.MASK,
          reason: `Phone keyword '${kw}' in context`,
          elementId: elementData.id
        });
        return detections;
      }
    }

    // 6. Financial Check
    for (const kw of SENSITIVE_KEYWORDS.FINANCIAL) {
      if (combinedContext.includes(kw)) {
        detections.push({
          type: SENSITIVITY_TYPES.FINANCIAL,
          confidence: 0.90,
          strategy: REDACTION_STRATEGIES.MASK,
          reason: `Financial keyword '${kw}' in context`,
          elementId: elementData.id
        });
        return detections;
      }
    }

    return detections;
  }

  function scanContextForPII(context) {
    if (!context || !Array.isArray(context.elements)) {
      return { sensitiveElements: [], totalSensitiveCount: 0 };
    }

    const sensitiveElements = [];
    for (const el of context.elements) {
      const detections = detectElementSensitivity(el);
      if (detections.length > 0) {
        el.isSensitive = true;
        el.sensitiveDetections = detections;
        sensitiveElements.push({
          elementId: el.id,
          tag: el.tag,
          label: el.label,
          detections: detections,
          boundingBox: el.boundingBox
        });
      } else {
        el.isSensitive = false;
        el.sensitiveDetections = [];
      }
    }

    return {
      sensitiveElements: sensitiveElements,
      totalSensitiveCount: sensitiveElements.length
    };
  }

  // Export
  if (typeof window !== 'undefined') {
    window.__rakshakPIIDetector = {
      SENSITIVITY_TYPES,
      REDACTION_STRATEGIES,
      detectElementSensitivity,
      scanContextForPII,
      validateLuhn
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      SENSITIVITY_TYPES,
      REDACTION_STRATEGIES,
      detectElementSensitivity,
      scanContextForPII,
      validateLuhn
    };
  }
})();
