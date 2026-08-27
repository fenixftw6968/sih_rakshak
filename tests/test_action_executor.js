import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('--- Running Local Action Validator & Executor Tests ---');

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
  }

  setAttribute(k, v) { this.attributes.set(k, v); }
  getAttribute(k) { return this.attributes.get(k) || null; }
  getBoundingClientRect() { return { left: 10, top: 20, width: 200, height: 40 }; }
  focus() { this.focused = true; }
  scrollIntoView() {}
  dispatchEvent(evt) { this.dispatchedEvents.push(evt.type || evt); return true; }
  click() { this.dispatchEvent({ type: 'click' }); }
}

const mockDoc = {
  elements: [],
  querySelector(sel) {
    if (sel.includes('data-rakshak-id="')) {
      const id = sel.match(/data-rakshak-id="([^"]+)"/)?.[1];
      return this.elements.find(e => e.getAttribute('data-rakshak-id') === id) || null;
    }
    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      return this.elements.find(e => e.id === id) || null;
    }
    return null;
  },
  getElementById(id) {
    return this.elements.find(e => e.id === id) || null;
  }
};

global.Element = MockElement;
global.HTMLInputElement = MockElement;
global.HTMLTextAreaElement = MockElement;
global.document = mockDoc;
global.window = {
  getComputedStyle: (el) => el.style,
  scrollBy: () => {},
  innerWidth: 1920,
  innerHeight: 1080
};
global.KeyboardEvent = function(type, opts) { return { type, ...opts }; };
global.MouseEvent = function(type, opts) { return { type, ...opts }; };
global.Event = function(type, opts) { return { type, ...opts }; };

const executor = require('../extension/content/action_executor.js');

// Setup mock interactive elements
const searchInput = new MockElement('input', 'search-box', 'text');
searchInput.setAttribute('data-rakshak-id', 'rakshak-el-1');
mockDoc.elements.push(searchInput);

const submitButton = new MockElement('button', 'submit-btn', 'submit');
submitButton.setAttribute('data-rakshak-id', 'rakshak-el-2');
mockDoc.elements.push(submitButton);

// Test 1: Action Whitelist Validation
console.log('\n[Test 1] Action Whitelist Validation:');
const invalidAction = { action: 'EXECUTE_SCRIPT', code: 'alert(1)' };
const valRes1 = executor.validateAction(invalidAction);
console.log(`- Invalid action rejection: ${!valRes1.valid ? 'PASS' : 'FAIL'} (${valRes1.error})`);
if (valRes1.valid) process.exit(1);

// Test 2: Missing Element Rejection
console.log('\n[Test 2] Missing Element Rejection:');
const missingElAction = { action: 'CLICK', target: { elementId: 'non-existent-id' } };
const valRes2 = executor.validateAction(missingElAction);
console.log(`- Missing element rejection: ${!valRes2.valid ? 'PASS' : 'FAIL'} (${valRes2.error})`);
if (valRes2.valid) process.exit(1);

// Test 3: Valid TYPE Action Execution (e.g. YouTube search for "striver")
console.log('\n[Test 3] TYPE Action Execution:');
const typeAction = {
  action: 'TYPE',
  target: { elementId: 'rakshak-el-1', selector: '#search-box' },
  value: 'striver',
  reason: 'Entering query into YouTube search field'
};
const valRes3 = executor.validateAction(typeAction);
if (!valRes3.valid) {
  console.error('[FAIL] Valid TYPE action failed validation:', valRes3.error);
  process.exit(1);
}
executor.executeAction(typeAction).then((execRes3) => {
  console.log(`- TYPE execution result: ${execRes3.success ? 'PASS' : 'FAIL'} (${execRes3.message})`);
  console.log(`- Element value verified: '${searchInput.value}'`);
  console.log(`- Dispatched events: ${searchInput.dispatchedEvents.join(', ')}`);
  if (!execRes3.success || searchInput.value !== 'striver') {
    console.error('[FAIL] TYPE action did not set value correctly');
    process.exit(1);
  }

  // Test 4: KEY Action (ENTER)
  console.log('\n[Test 4] KEY Action (ENTER) Execution:');
  const keyAction = { action: 'KEY', key: 'ENTER', target: { elementId: 'rakshak-el-1' } };
  executor.executeAction(keyAction).then((execRes4) => {
    console.log(`- KEY execution result: ${execRes4.success ? 'PASS' : 'FAIL'} (${execRes4.message})`);
    if (!execRes4.success) {
      console.error('[FAIL] KEY action failed');
      process.exit(1);
    }

    // Test 5: CLICK Action Execution
    console.log('\n[Test 5] CLICK Action Execution:');
    const clickAction = { action: 'CLICK', target: { elementId: 'rakshak-el-2' }, reason: 'Clicking submit' };
    executor.executeAction(clickAction).then((execRes5) => {
      console.log(`- CLICK execution result: ${execRes5.success ? 'PASS' : 'FAIL'} (${execRes5.message})`);
      if (!execRes5.success) {
        console.error('[FAIL] CLICK action failed');
        process.exit(1);
      }

      // Test 6: PLAY Action Execution
      console.log('\n[Test 6] PLAY Action Execution:');
      const videoEl = new MockElement('video', 'test-video', null);
      videoEl.setAttribute('data-rakshak-id', 'rakshak-el-3');
      videoEl.play = function() { this.played = true; };
      mockDoc.elements.push(videoEl);

      const playAction = { action: 'PLAY', target: { elementId: 'rakshak-el-3' }, reason: 'Playing video' };
      const valResPlay = executor.validateAction(playAction);
      console.log(`- PLAY validation result: ${valResPlay.valid ? 'PASS' : 'FAIL'}`);
      if (!valResPlay.valid) process.exit(1);

      executor.executeAction(playAction).then((execResPlay) => {
        console.log(`- PLAY execution result: ${execResPlay.success ? 'PASS' : 'FAIL'} (${execResPlay.message})`);
        if (!execResPlay.success) process.exit(1);

        // Test 7: STOP Action
        console.log('\n[Test 7] STOP Action:');
        const stopAction = { action: 'STOP', reason: 'Goal completed successfully' };
        executor.executeAction(stopAction).then((execRes7) => {
          console.log(`- STOP execution result: ${execRes7.success ? 'PASS' : 'FAIL'} (${execRes7.message})`);
          if (!execRes7.success) {
            console.error('[FAIL] STOP action failed');
            process.exit(1);
          }

          console.log('\n[ALL TESTS PASSED] Local Action Validator & Executor verified successfully.');
        });
      });
    });
  });
});
