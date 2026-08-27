import { createRequire } from 'module';
const require = createRequire(import.meta.url);

console.log('--- Running In-Page Overlay Isolation & Safety Verification Tests ---');

// Mock DOM elements
class MockElement {
  constructor(tag, id = null, attributes = {}, isConnected = true) {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.attributes = new Map(Object.entries(attributes));
    this.isConnected = isConnected;
    this.style = { display: 'block', visibility: 'visible', opacity: '1', pointerEvents: 'auto' };
    this.parentElement = null;
  }

  getAttribute(k) { return this.attributes.get(k) || null; }
  hasAttribute(k) { return this.attributes.has(k); }
  setAttribute(k, v) { this.attributes.set(k, v); }
  getBoundingClientRect() { return { left: 10, top: 10, width: 100, height: 30 }; }
  
  closest(selector) {
    let curr = this;
    while (curr) {
      if (selector === '#rakshak-agent-overlay-root' && (curr.id === 'rakshak-agent-overlay-root')) return curr;
      if (selector === '[data-rakshak-overlay]' && (curr.hasAttribute('data-rakshak-overlay'))) return curr;
      curr = curr.parentElement;
    }
    return null;
  }
}

global.Element = MockElement;
global.HTMLInputElement = MockElement;
global.HTMLTextAreaElement = MockElement;
global.window = {
  getComputedStyle: (el) => el.style,
  innerWidth: 1920,
  innerHeight: 1080,
  location: { href: 'https://example.com' }
};

const executor = require('../extension/content/action_executor.js');

// Test 1: Action executor must reject overlay elements
const overlayHost = new MockElement('div', 'rakshak-agent-overlay-root', { 'data-rakshak-overlay': 'true' });
const overlayBtn = new MockElement('button', 'closeBtn', {});
overlayBtn.parentElement = overlayHost;

const isInteractable = executor.isElementInteractable(overlayBtn);
console.log(`[Test 1] Overlay button interactability blocked: ${!isInteractable ? 'PASS' : 'FAIL'}`);

if (isInteractable) {
  throw new Error('Safety failure: Executor must not consider overlay elements interactable!');
}

// Test 2: Standard webpage elements are allowed
const webBtn = new MockElement('button', 'submitBtn', {});
const isWebInteractable = executor.isElementInteractable(webBtn);
console.log(`[Test 2] Webpage button interactability allowed: ${isWebInteractable ? 'PASS' : 'FAIL'}`);

if (!isWebInteractable) {
  throw new Error('Executor failed to allow standard web button');
}

console.log('\n[ALL OVERLAY ISOLATION TESTS PASSED] In-page overlay isolation verified successfully.');
