import { createRequire } from 'module';
const require = createRequire(import.meta.url);

console.log('--- Running Privacy-Preserving Credential Execution Flow Tests ---');

// Mock DOM environment
class MockElement {
  constructor(tag, id = null, type = 'text') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.type = type;
    this.isConnected = true;
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

class MockDocument {
  constructor() {
    this.elements = [];
  }

  querySelector(sel) {
    if (sel.includes('data-rakshak-id="')) {
      const id = sel.match(/data-rakshak-id="([^"]+)"/)?.[1];
      return this.elements.find(e => e.getAttribute('data-rakshak-id') === id) || null;
    }
    if (sel.includes('type="password"')) {
      return this.elements.find(e => e.type === 'password') || null;
    }
    if (sel.includes('type="email"') || sel.includes('type="text"')) {
      return this.elements.find(e => e.type === 'email' || e.type === 'text') || null;
    }
    if (sel.startsWith('#')) {
      const id = sel.slice(1);
      return this.elements.find(e => e.id === id) || null;
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
  innerHeight: 1080
};
global.KeyboardEvent = function(type, opts) { return { type, ...opts }; };
global.MouseEvent = function(type, opts) { return { type, ...opts }; };
global.Event = function(type, opts) { return { type, ...opts }; };

const executor = require('../extension/content/action_executor.js');
const privacyGate = require('../extension/privacy_gate/privacy_gate.js');

async function testCredentialExecutionFlow() {
  // Setup DOM with login form
  const userInput = new MockElement('input', 'username', 'text');
  userInput.setAttribute('data-rakshak-id', 'rakshak-el-8');
  
  const passInput = new MockElement('input', 'password', 'password');
  passInput.setAttribute('data-rakshak-id', 'rakshak-el-9');

  const submitBtn = new MockElement('button', 'submit-btn', 'submit');
  submitBtn.setAttribute('data-rakshak-id', 'rakshak-el-10');

  mockDoc.elements = [userInput, passInput, submitBtn];

  console.log('\n[Test 1] Validate and Execute Semantic FILL_CREDENTIALS');
  const fillAction = {
    action: 'FILL_CREDENTIALS',
    emailTarget: 'rakshak-el-8',
    passwordTarget: 'rakshak-el-9',
    emailValue: 'kartik',
    passwordValue: 'kartik123',
    reason: 'Filling login credentials locally'
  };

  const valRes = executor.validateAction(fillAction);
  console.log(`- Action Validation: ${valRes.valid ? 'PASS' : 'FAIL'}`);
  if (!valRes.valid) {
    console.error(`[FAIL] Validation error: ${valRes.error}`);
    process.exit(1);
  }

  const execRes = await executor.executeAction(fillAction);
  console.log(`- Action Execution: ${execRes.success ? 'PASS' : 'FAIL'} (${execRes.message})`);
  console.log(`- Username Input Value: '${userInput.value}'`);
  console.log(`- Password Input Value: '${passInput.value}'`);

  if (!execRes.success || userInput.value !== 'kartik' || passInput.value !== 'kartik123') {
    console.error('[FAIL] Values were not populated correctly into webpage inputs.');
    process.exit(1);
  }

  // Ensure placeholders are NOT present in the inputs
  if (userInput.value.includes('[REDACTED') || passInput.value.includes('[REDACTED')) {
    console.error('[FAIL] Redaction placeholders were typed into webpage fields.');
    process.exit(1);
  }

  console.log('\n[Test 2] Validate Privacy Gate strips raw credentials from outgoing context');
  const outgoingPayload = {
    task: 'https://mind-forge-frontend-chi.vercel.app/ open this website and login with this credentials username:kartik passwword: kartik123',
    page: { title: 'Login - Mind Forge', url: 'https://mind-forge-frontend-chi.vercel.app/login' },
    elements: [
      { id: 'rakshak-el-8', tag: 'input', type: 'text', label: 'username', value: userInput.value },
      { id: 'rakshak-el-9', tag: 'input', type: 'password', label: 'password', value: passInput.value }
    ]
  };

  const gateRes = privacyGate.validateAndSanitizePayload(outgoingPayload);
  const sanitizedJson = JSON.stringify(gateRes.sanitizedPayload);

  console.log(`- Password 'kartik123' leaked to AI payload: ${sanitizedJson.includes('kartik123') ? 'YES (FAIL)' : 'NO (PASS)'}`);
  console.log(`- Password placeholder present: ${sanitizedJson.includes('[REDACTED_PASSWORD]') ? 'YES (PASS)' : 'NO (FAIL)'}`);

  if (sanitizedJson.includes('kartik123') || !sanitizedJson.includes('[REDACTED_PASSWORD]')) {
    console.error('[FAIL] Privacy gate failed to sanitize password before external AI context.');
    process.exit(1);
  }

  console.log('\n[PASS] All Privacy-Preserving Credential Execution tests passed successfully.');
}

testCredentialExecutionFlow().catch((err) => {
  console.error('[FAIL] Uncaught test exception:', err);
  process.exit(1);
});
