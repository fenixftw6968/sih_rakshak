import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { validateAndSanitizePayload, sanitizeString } = require('../extension/privacy_gate/privacy_gate.js');

console.log('--- Running Phase 5 Privacy Gate Negative & Leakage Tests ---');

// Test Case 1: Injection of raw password value
const testPayload1 = {
  task: 'Sign in to dashboard',
  page: { title: 'Login Page', url: 'https://auth.example.com' },
  elements: [
    { id: 'el-1', tag: 'input', type: 'password', label: 'Password', value: 'superSecretPassword123!' }
  ]
};

const result1 = validateAndSanitizePayload(testPayload1);
console.log('Test 1 (Raw Password Injection):');
console.log(`- Original Value: 'superSecretPassword123!'`);
console.log(`- Sanitized Value: '${result1.sanitizedPayload.elements[0].value}'`);
console.log(`- Violations Detected: ${result1.auditLog.violationsDetected}`);
if (result1.sanitizedPayload.elements[0].value !== '[REDACTED_PASSWORD]') {
  console.error('[FAIL] Password was not masked with [REDACTED_PASSWORD]');
  process.exit(1);
}

// Test Case 2: SSN / National ID in form field
const testPayload2 = {
  task: 'Submit verification',
  page: { title: 'Tax Portal', url: 'https://tax.example.com' },
  elements: [
    { id: 'el-2', tag: 'input', type: 'text', label: 'SSN', value: '123-45-6789' }
  ]
};

const result2 = validateAndSanitizePayload(testPayload2);
console.log('\nTest 2 (SSN / National ID Injection):');
console.log(`- Original Value: '123-45-6789'`);
console.log(`- Sanitized Value: '${result2.sanitizedPayload.elements[0].value}'`);
if (result2.sanitizedPayload.elements[0].value !== '[REDACTED_SSN_ID]') {
  console.error('[FAIL] SSN was not masked with [REDACTED_SSN_ID]');
  process.exit(1);
}

// Test Case 3: Credit card number injection
const testPayload3 = {
  task: 'Checkout',
  elements: [
    { id: 'el-3', tag: 'input', type: 'text', label: 'Card Number', value: '4532-0151-1283-0366' }
  ]
};

const result3 = validateAndSanitizePayload(testPayload3);
console.log('\nTest 3 (Credit Card Number Injection):');
console.log(`- Original Value: '4532-0151-1283-0366'`);
console.log(`- Sanitized Value: '${result3.sanitizedPayload.elements[0].value}'`);
if (result3.sanitizedPayload.elements[0].value !== '[REDACTED_CREDIT_CARD]') {
  console.error('[FAIL] Credit Card was not masked');
  process.exit(1);
}

// Test Case 4: Unauthorized root keys (e.g. attempting to leak cookies or tokens)
const testPayload4 = {
  task: 'General task',
  unauthorized_cookies: 'session_id=abcdef123456',
  internal_auth_header: 'Bearer secret_admin_token',
  page: { title: 'Dashboard' }
};

const result4 = validateAndSanitizePayload(testPayload4);
console.log('\nTest 4 (Unauthorized Field Whitelist):');
console.log(`- Keys in payload before: ${Object.keys(testPayload4).join(', ')}`);
console.log(`- Keys in payload after:  ${Object.keys(result4.sanitizedPayload).join(', ')}`);
if ('unauthorized_cookies' in result4.sanitizedPayload || 'internal_auth_header' in result4.sanitizedPayload) {
  console.error('[FAIL] Privacy Gate permitted non-whitelisted keys to leak.');
  process.exit(1);
}

// Test Case 5: Email and Phone replacement in string contexts
const testPayload5 = {
  task: 'Contact customer at support@enterprise.com or call +1-555-432-1098'
};

const result5 = validateAndSanitizePayload(testPayload5);
console.log('\nTest 5 (Task Prompt PII Sanitization):');
console.log(`- Original Task: '${testPayload5.task}'`);
console.log(`- Sanitized Task: '${result5.sanitizedPayload.task}'`);
if (result5.sanitizedPayload.task.includes('support@enterprise.com') || result5.sanitizedPayload.task.includes('555-432-1098')) {
  console.error('[FAIL] Email/phone was not sanitized in prompt');
  process.exit(1);
}

console.log('\n[PASS] Phase 5 Privacy Gate passed all 5 adversarial leakage checks.');
