import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { redactPixelBuffer } = require('../extension/content/visual_redactor.js');

console.log('--- Running Phase 4 Visual Redaction Pixel Integrity Test ---');

const width = 100;
const height = 100;
const totalPixels = width * height;
const pixelBuffer = new Uint8ClampedArray(totalPixels * 4);

// Fill with mock bright pixels (representing readable sensitive screen text, e.g., RGB 255, 255, 255)
for (let i = 0; i < pixelBuffer.length; i += 4) {
  pixelBuffer[i] = 255;     // R
  pixelBuffer[i + 1] = 255; // G
  pixelBuffer[i + 2] = 255; // B
  pixelBuffer[i + 3] = 255; // A
}

// Define sensitive bounding box (e.g. password input at x: 20, y: 30, w: 50, h: 20)
const sensitiveRect = { x: 20, y: 30, width: 50, height: 20 };
const outsideCoord = { x: 5, y: 5 };

// Perform blackout redaction
redactPixelBuffer(pixelBuffer, width, height, [sensitiveRect], 'BLACKOUT');

// Verification 1: Verify all pixels INSIDE the sensitive rectangle are redacted to opaque dark pixels
let insideRedactedCount = 0;
let insideTotal = sensitiveRect.width * sensitiveRect.height;

for (let y = sensitiveRect.y; y < sensitiveRect.y + sensitiveRect.height; y++) {
  for (let x = sensitiveRect.x; x < sensitiveRect.x + sensitiveRect.width; x++) {
    const idx = (y * width + x) * 4;
    const r = pixelBuffer[idx];
    const g = pixelBuffer[idx + 1];
    const b = pixelBuffer[idx + 2];
    const a = pixelBuffer[idx + 3];

    // Check that original bright white pixel (255, 255, 255) is completely destroyed
    if (r === 9 && g === 13 && b === 19 && a === 255) {
      insideRedactedCount++;
    }
  }
}

// Verification 2: Verify pixels OUTSIDE the sensitive rectangle remain completely intact
const outsideIdx = (outsideCoord.y * width + outsideCoord.x) * 4;
const outsideIntact = (
  pixelBuffer[outsideIdx] === 255 &&
  pixelBuffer[outsideIdx + 1] === 255 &&
  pixelBuffer[outsideIdx + 2] === 255
);

console.log(`Inside Bounding Box Redacted Pixels: ${insideRedactedCount} / ${insideTotal} (100%)`);
console.log(`Outside Bounding Box Content Intact: ${outsideIntact ? 'YES' : 'NO'}`);

if (insideRedactedCount !== insideTotal || !outsideIntact) {
  console.error('[FAIL] Visual redaction test failed: Pixel leak detected or non-sensitive area corrupted.');
  process.exit(1);
} else {
  console.log('[PASS] Phase 4 Visual Redaction verified with zero visual leakage.');
}
