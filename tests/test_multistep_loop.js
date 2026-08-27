import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('--- Running Generic Dynamic Multi-Step Agent Loop Tests ---');

// Mock DOM environment
class MockElement {
  constructor(tag, id = null, type = 'text', isConnected = true) {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.type = type;
    this.isConnected = isConnected;
    this.value = '';
    this.attributes = new Map();
    this.style = { display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto' };
    this.dispatchedEvents = [];
    this.focused = false;
    this.played = false;
  }

  setAttribute(k, v) { this.attributes.set(k, v); }
  getAttribute(k) { return this.attributes.get(k) || null; }
  getBoundingClientRect() { return { left: 10, top: 20, width: 200, height: 40 }; }
  focus() { this.focused = true; }
  scrollIntoView() {}
  dispatchEvent(evt) { this.dispatchedEvents.push(evt.type || evt); return true; }
  click() { this.dispatchEvent({ type: 'click' }); }
  play() { this.played = true; return Promise.resolve(); }
}

class MockDocument {
  constructor() {
    this.title = 'Generic Web Portal';
    this.elements = [];
  }

  querySelector(sel) {
    if (sel.includes('data-rakshak-id="')) {
      const id = sel.match(/data-rakshak-id="([^"]+)"/)?.[1];
      return this.elements.find(e => e.getAttribute('data-rakshak-id') === id) || null;
    }
    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      return this.elements.find(e => e.id === id) || null;
    }
    if (sel.includes('video')) {
      return this.elements.find(e => e.tagName === 'VIDEO') || null;
    }
    return this.elements[0] || null;
  }

  getElementById(id) {
    return this.elements.find(e => e.id === id) || null;
  }
}

const mockDoc = new MockDocument();

global.Element = MockElement;
global.HTMLInputElement = MockElement;
global.HTMLTextAreaElement = MockElement;
global.document = mockDoc;
global.window = {
  getComputedStyle: (el) => el.style,
  scrollBy: () => {},
  innerWidth: 1920,
  innerHeight: 1080,
  location: { href: 'https://example.com' }
};
global.KeyboardEvent = function(type, opts) { return { type, ...opts }; };
global.MouseEvent = function(type, opts) { return { type, ...opts }; };
global.Event = function(type, opts) { return { type, ...opts }; };

const executor = require('../extension/content/action_executor.js');
const privacyGate = require('../extension/privacy_gate/privacy_gate.js');

async function runTests() {
  // Test Scenario 1: Multi-Step Search and Play Media
  console.log('\n[Scenario 1] Dynamic Multi-Step Goal: "Search for machine learning course and play the intro video"');
  
  // Step 1: Initial Page DOM
  const searchBox = new MockElement('input', 'query-input', 'search');
  searchBox.setAttribute('data-rakshak-id', 'rakshak-el-1');
  mockDoc.elements = [searchBox];

  const step1Action = {
    action: 'TYPE',
    target: { elementId: 'rakshak-el-1', selector: '#query-input' },
    value: 'machine learning course',
    key: 'ENTER',
    reason: 'Type query and press Enter to search'
  };

  const val1 = executor.validateAction(step1Action);
  console.log(`- Step 1 Validation: ${val1.valid ? 'PASS' : 'FAIL'}`);
  const exec1 = await executor.executeAction(step1Action);
  console.log(`- Step 1 Execution: ${exec1.success ? 'PASS' : 'FAIL'} (${exec1.message})`);
  if (!exec1.success || searchBox.value !== 'machine learning course') process.exit(1);

  // Step 2: Fresh Page DOM after Search Navigation
  mockDoc.title = 'Search Results for machine learning course';
  const resultLink = new MockElement('a', 'result-item-1', 'link');
  resultLink.setAttribute('data-rakshak-id', 'rakshak-el-10'); // Fresh element ID
  mockDoc.elements = [searchBox, resultLink];

  const step2Action = {
    action: 'CLICK',
    target: { elementId: 'rakshak-el-10' },
    reason: 'Click the top relevant course link'
  };
  const val2 = executor.validateAction(step2Action);
  console.log(`- Step 2 (Fresh Context) Validation: ${val2.valid ? 'PASS' : 'FAIL'}`);
  const exec2 = await executor.executeAction(step2Action);
  console.log(`- Step 2 Execution: ${exec2.success ? 'PASS' : 'FAIL'} (${exec2.message})`);
  if (!exec2.success) process.exit(1);

  // Step 3: Fresh Page DOM after navigating to course player
  mockDoc.title = 'Machine Learning Intro Video Player';
  const videoPlayer = new MockElement('video', 'main-video-player', null);
  videoPlayer.setAttribute('data-rakshak-id', 'rakshak-el-20');
  mockDoc.elements = [videoPlayer];

  const step3Action = {
    action: 'PLAY',
    target: { elementId: 'rakshak-el-20' },
    reason: 'Start course intro video playback'
  };
  const val3 = executor.validateAction(step3Action);
  console.log(`- Step 3 (Media Play) Validation: ${val3.valid ? 'PASS' : 'FAIL'}`);
  const exec3 = await executor.executeAction(step3Action);
  console.log(`- Step 3 Execution: ${exec3.success ? 'PASS' : 'FAIL'} (${exec3.message})`);
  if (!exec3.success || !videoPlayer.played) process.exit(1);

  // Step 4: Verification and STOP
  const step4Action = {
    action: 'STOP',
    reason: 'Course intro video is playing and requested goal is completed'
  };
  const val4 = executor.validateAction(step4Action);
  const exec4 = await executor.executeAction(step4Action);
  console.log(`- Step 4 (STOP Verification): ${exec4.success ? 'PASS' : 'FAIL'} (${exec4.message})`);
  if (!exec4.success) process.exit(1);

  // Test Scenario 2: Stale Element ID Rejection (Target Validation Safety)
  console.log('\n[Scenario 2] Target Validation Safety: Stale / Removed Element');
  const staleAction = {
    action: 'CLICK',
    target: { elementId: 'rakshak-el-999' }, // Does not exist in current DOM
    reason: 'Clicking element that is no longer on page'
  };
  const valStale = executor.validateAction(staleAction);
  console.log(`- Stale Element Rejection: ${!valStale.valid ? 'PASS (Safely Rejected)' : 'FAIL'} (${valStale.error})`);
  if (valStale.valid) process.exit(1);

  // Test Scenario 3: Privacy Preservation across Multi-Step Workflow
  console.log('\n[Scenario 3] Privacy Preservation during Multi-Step Execution');
  const sensitivePayload = {
    task: 'Search and login with user alice@example.com and pass secret12345',
    page: { title: 'Sensitive Page', url: 'https://bank.example.com' },
    elements: [
      { id: 'el-p', tag: 'input', type: 'password', value: 'secret12345' },
      { id: 'el-s', tag: 'input', type: 'text', value: '123-45-6789' }
    ]
  };
  const gateRes = privacyGate.validateAndSanitizePayload(sensitivePayload);
  const sanitizedJson = JSON.stringify(gateRes.sanitizedPayload);
  const hasRawPass = sanitizedJson.includes('secret12345');
  const hasRawSSN = sanitizedJson.includes('123-45-6789');
  const hasRedactedPass = sanitizedJson.includes('[REDACTED_PASSWORD]');
  const hasRedactedSSN = sanitizedJson.includes('[REDACTED_SSN_ID]');
  
  console.log(`- Raw Password Leaked: ${hasRawPass ? 'YES (FAIL)' : 'NO (PASS)'}`);
  console.log(`- Raw SSN Leaked: ${hasRawSSN ? 'YES (FAIL)' : 'NO (PASS)'}`);
  console.log(`- Redacted Tokens Present: ${hasRedactedPass && hasRedactedSSN ? 'YES (PASS)' : 'NO (FAIL)'}`);
  if (hasRawPass || hasRawSSN || !hasRedactedPass || !hasRedactedSSN) process.exit(1);

  console.log('\n[ALL MULTI-STEP TESTS PASSED] Generic multi-step agent loop verified successfully.');
}

runTests();
