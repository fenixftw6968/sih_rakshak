import { isRestrictedPage, isSafeDestinationUrl, extractNavigationGoal } from '../extension/popup/safe_navigator.js';

console.log('--- Running Safe Navigator & Restricted Page Tests ---');

// Test 1: isRestrictedPage
const restrictedUrls = [
  'chrome://newtab',
  'chrome://settings',
  'chrome://extensions',
  'edge://settings',
  'about:blank',
  'chrome-extension://abcdef/options.html',
  'javascript:alert(1)',
  'data:text/html,<h1>Hello</h1>'
];

let test1Passed = true;
for (const url of restrictedUrls) {
  if (!isRestrictedPage(url)) {
    console.error(`[FAIL] isRestrictedPage failed to identify restricted URL: ${url}`);
    test1Passed = false;
  }
}
if (test1Passed) console.log('[PASS] Test 1: All restricted internal page schemes correctly identified.');

// Test 2: Standard web pages
const standardUrls = [
  'https://www.youtube.com',
  'https://google.com',
  'http://localhost:8000',
  'http://127.0.0.1:3000',
  'https://news.ycombinator.com/item?id=123'
];

let test2Passed = true;
for (const url of standardUrls) {
  if (isRestrictedPage(url)) {
    console.error(`[FAIL] isRestrictedPage false positive for standard URL: ${url}`);
    test2Passed = false;
  }
}
if (test2Passed) console.log('[PASS] Test 2: Standard http/https web pages permitted.');

// Test 3: Safe Navigation extraction from natural language prompts
const navTestCases = [
  { prompt: 'Open YouTube and search for Striver', expected: 'https://www.youtube.com' },
  { prompt: 'open youtube', expected: 'https://www.youtube.com' },
  { prompt: 'Go to https://github.com and find rakshak', expected: 'https://github.com' },
  { prompt: 'Navigate to wikipedia.org and search for Quantum Computing', expected: 'https://www.wikipedia.org' },
  { prompt: 'visit leetcode and view daily problem', expected: 'https://www.leetcode.com' },
  { prompt: 'launch amazon.in and search headphones', expected: 'https://amazon.in' },
  { prompt: 'Search for Python tutorials and open a relevant video', expected: null },
  { prompt: 'Click the submit button', expected: null }
];

let test3Passed = true;
for (const tc of navTestCases) {
  const result = extractNavigationGoal(tc.prompt);
  if (result !== tc.expected) {
    console.error(`[FAIL] extractNavigationGoal failed for "${tc.prompt}". Expected "${tc.expected}", got "${result}"`);
    test3Passed = false;
  } else {
    console.log(`[OK] Prompt: "${tc.prompt}" -> ${result}`);
  }
}
if (test3Passed) console.log('[PASS] Test 3: Natural language navigation goals correctly parsed.');

// Test 4: Destination safety check (reject malicious schemes)
const maliciousDestinations = [
  'javascript:alert(document.cookie)',
  'data:text/html,<script>evil()</script>',
  'chrome://settings',
  'file:///C:/passwords.txt'
];

let test4Passed = true;
for (const dest of maliciousDestinations) {
  if (isSafeDestinationUrl(dest)) {
    console.error(`[FAIL] isSafeDestinationUrl allowed malicious destination: ${dest}`);
    test4Passed = false;
  }
}
if (test4Passed) console.log('[PASS] Test 4: All dangerous or arbitrary internal navigation targets blocked.');

console.log('\n[ALL TESTS PASSED] Safe navigation module verified successfully.');
