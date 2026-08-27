import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { SENSITIVITY_TYPES, detectElementSensitivity, scanContextForPII, validateLuhn } = require('../extension/content/pii_detector.js');

console.log('--- Running Phase 3 PII Detection Benchmark ---');

// Test dataset containing True Positives (Sensitive) and True Negatives (Non-Sensitive)
const testCases = [
  // Sensitive cases (True Positives)
  {
    element: { id: 'el-1', tag: 'input', type: 'password', name: 'user_pass', label: 'Password', value: 'secret99' },
    shouldBeSensitive: true,
    expectedType: SENSITIVITY_TYPES.PASSWORD
  },
  {
    element: { id: 'el-2', tag: 'input', type: 'text', name: 'pin_code', label: 'Enter 4-digit PIN', value: '1234' },
    shouldBeSensitive: true,
    expectedType: SENSITIVITY_TYPES.PASSWORD
  },
  {
    element: { id: 'el-3', tag: 'input', type: 'email', name: 'email', label: 'Email', value: 'alice@domain.com' },
    shouldBeSensitive: true,
    expectedType: SENSITIVITY_TYPES.EMAIL
  },
  {
    element: { id: 'el-4', tag: 'input', type: 'text', name: 'user_email', label: 'Contact', value: 'bob.smith@corp.org' },
    shouldBeSensitive: true,
    expectedType: SENSITIVITY_TYPES.EMAIL
  },
  {
    element: { id: 'el-5', tag: 'input', type: 'tel', name: 'phone', label: 'Mobile Number', value: '+1-555-123-4567' },
    shouldBeSensitive: true,
    expectedType: SENSITIVITY_TYPES.PHONE
  },
  {
    element: { id: 'el-6', tag: 'input', type: 'text', name: 'ssn', label: 'Social Security Number', value: '123-45-6789' },
    shouldBeSensitive: true,
    expectedType: SENSITIVITY_TYPES.SSN_ID
  },
  {
    element: { id: 'el-7', tag: 'input', type: 'text', name: 'aadhaar_id', label: 'National Tax / Aadhaar ID', value: '' },
    shouldBeSensitive: true,
    expectedType: SENSITIVITY_TYPES.SSN_ID
  },
  {
    element: { id: 'el-8', tag: 'input', type: 'text', name: 'cc_number', label: 'Credit Card Number', value: '4532015112830366' },
    shouldBeSensitive: true,
    expectedType: SENSITIVITY_TYPES.CREDIT_CARD
  },
  {
    element: { id: 'el-9', tag: 'input', type: 'text', name: 'salary_info', label: 'Annual Salary', value: '$120,000' },
    shouldBeSensitive: true,
    expectedType: SENSITIVITY_TYPES.FINANCIAL
  },

  // Non-Sensitive cases (True Negatives)
  {
    element: { id: 'el-10', tag: 'input', type: 'text', name: 'search_query', label: 'Search products', value: 'mechanical keyboard' },
    shouldBeSensitive: false
  },
  {
    element: { id: 'el-11', tag: 'input', type: 'text', name: 'city_name', label: 'City', value: 'San Francisco' },
    shouldBeSensitive: false
  },
  {
    element: { id: 'el-12', tag: 'button', type: 'submit', name: 'submit_btn', label: 'Sign In Now', value: 'Sign In' },
    shouldBeSensitive: false
  },
  {
    element: { id: 'el-13', tag: 'a', type: null, name: null, label: 'Read Privacy Policy', value: null },
    shouldBeSensitive: false
  },
  {
    element: { id: 'el-14', tag: 'input', type: 'checkbox', name: 'newsletter', label: 'Subscribe to newsletter', value: 'on' },
    shouldBeSensitive: false
  },
  {
    element: { id: 'el-15', tag: 'textarea', type: null, name: 'user_feedback', label: 'General Feedback', value: 'Great application!' },
    shouldBeSensitive: false
  }
];

let truePositives = 0;
let falsePositives = 0;
let trueNegatives = 0;
let falseNegatives = 0;

for (const tc of testCases) {
  const detections = detectElementSensitivity(tc.element);
  const detectedSensitive = detections.length > 0;

  if (tc.shouldBeSensitive) {
    if (detectedSensitive) {
      truePositives++;
      const topType = detections[0].type;
      if (tc.expectedType && topType !== tc.expectedType) {
        console.warn(`[WARN] Case ${tc.element.id}: Expected ${tc.expectedType}, got ${topType}`);
      }
    } else {
      falseNegatives++;
      console.error(`[FN] Failed to detect sensitive element: ${JSON.stringify(tc.element)}`);
    }
  } else {
    if (detectedSensitive) {
      falsePositives++;
      console.error(`[FP] Incorrectly flagged non-sensitive element: ${JSON.stringify(tc.element)}`);
    } else {
      trueNegatives++;
    }
  }
}

const precision = truePositives / (truePositives + falsePositives);
const recall = truePositives / (truePositives + falseNegatives);
const f1 = (2 * precision * recall) / (precision + recall);

console.log('\n--- Metrics Report ---');
console.log(`True Positives (TP):  ${truePositives}`);
console.log(`True Negatives (TN):  ${trueNegatives}`);
console.log(`False Positives (FP): ${falsePositives}`);
console.log(`False Negatives (FN): ${falseNegatives}`);
console.log(`Precision:            ${(precision * 100).toFixed(2)}%`);
console.log(`Recall:               ${(recall * 100).toFixed(2)}%`);
console.log(`F1 Score:             ${(f1 * 100).toFixed(2)}%`);

if (falseNegatives > 0 || falsePositives > 0) {
  console.error('\nBenchmark failed: Precision or Recall is not 100%.');
  process.exit(1);
} else {
  console.log('\nPhase 3 PII Detection Benchmark PASSED perfectly (100% Precision, 100% Recall).');
}
