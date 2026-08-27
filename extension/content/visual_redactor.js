/**
 * Rakshak Local Visual Redactor
 * Performs in-memory pixel-level redaction (blackout, blur, mask overlays)
 * on captured screen regions corresponding to sensitive elements.
 */

(function () {
  'use strict';

  /**
   * Applies blackout redaction to a 2D canvas context over a specified bounding box.
   */
  function applyBlackout(ctx, rect, label = 'REDACTED') {
    const { x, y, width, height } = rect;
    // Overwrite all underlying pixels completely
    ctx.fillStyle = '#090d13';
    ctx.fillRect(x, y, width, height);

    // Draw privacy border
    ctx.strokeStyle = '#f85149';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, width, height);

    // Draw label
    ctx.fillStyle = '#f85149';
    ctx.font = 'bold 11px sans-serif';
    ctx.textBaseline = 'middle';
    const text = `🔒 [${label.toUpperCase()}]`;
    const textWidth = ctx.measureText(text).width;

    if (width > textWidth + 10 && height >= 16) {
      ctx.fillText(text, x + 6, y + height / 2);
    }
  }

  /**
   * Applies box-blur redaction to a 2D canvas context over a specified bounding box.
   */
  function applyBlur(ctx, rect, passes = 3) {
    const { x, y, width, height } = rect;
    if (width <= 0 || height <= 0) return;

    try {
      const imgData = ctx.getImageData(x, y, width, height);
      const data = imgData.data;

      // Simple fast box blur on pixel buffer
      for (let p = 0; p < passes; p++) {
        for (let i = 0; i < data.length; i += 4) {
          // Pixelate / average block
          const block = 8;
          const pixelIndex = Math.floor(i / (4 * block)) * (4 * block);
          if (pixelIndex < data.length) {
            data[i] = data[pixelIndex];
            data[i + 1] = data[pixelIndex + 1];
            data[i + 2] = data[pixelIndex + 2];
          }
        }
      }

      ctx.putImageData(imgData, x, y);
    } catch (e) {
      // Fallback to blackout if pixel access is blocked
      applyBlackout(ctx, rect, 'BLUR_MASK');
    }
  }

  /**
   * Pure pixel array buffer redaction utility for headless / unit test verification.
   */
  function redactPixelBuffer(pixelBuffer, imgWidth, imgHeight, sensitiveRects, strategy = 'BLACKOUT') {
    // pixelBuffer: Uint8ClampedArray (RGBA)
    for (const rect of sensitiveRects) {
      const startX = Math.max(0, rect.x);
      const startY = Math.max(0, rect.y);
      const endX = Math.min(imgWidth, rect.x + rect.width);
      const endY = Math.min(imgHeight, rect.y + rect.height);

      for (let y = startY; y < endY; y++) {
        for (let x = startX; x < endX; x++) {
          const idx = (y * imgWidth + x) * 4;
          if (strategy === 'BLACKOUT' || strategy === 'MASK') {
            // Overwrite RGBA with opaque dark color [9, 13, 19, 255]
            pixelBuffer[idx] = 9;
            pixelBuffer[idx + 1] = 13;
            pixelBuffer[idx + 2] = 19;
            pixelBuffer[idx + 3] = 255;
          } else if (strategy === 'BLUR') {
            // Overwrite with constant blur average
            pixelBuffer[idx] = 128;
            pixelBuffer[idx + 1] = 128;
            pixelBuffer[idx + 2] = 128;
            pixelBuffer[idx + 3] = 255;
          }
        }
      }
    }
    return pixelBuffer;
  }

  /**
   * Redacts an HTML Image or Canvas based on a list of sensitive element bounding boxes.
   * Returns a promise resolving to a sanitized base64 data URL.
   */
  function redactScreenImage(imageSource, sensitiveElements, devicePixelRatio = 1) {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const img = new Image();

      img.onload = () => {
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');

        // Draw original screenshot into private canvas memory
        ctx.drawImage(img, 0, 0);

        // Apply redactions for each detected sensitive item
        for (const item of sensitiveElements) {
          const rawBox = item.boundingBox;
          if (!rawBox || rawBox.width <= 0 || rawBox.height <= 0) continue;

          // Scale coordinates by devicePixelRatio if screenshot is retina / high-DPI
          const rect = {
            x: Math.round(rawBox.x * devicePixelRatio),
            y: Math.round(rawBox.y * devicePixelRatio),
            width: Math.round(rawBox.width * devicePixelRatio),
            height: Math.round(rawBox.height * devicePixelRatio)
          };

          const topDetection = item.detections?.[0];
          const strategy = topDetection?.strategy || 'BLACKOUT';
          const label = topDetection?.type || 'SENSITIVE';

          if (strategy === 'BLUR') {
            applyBlur(ctx, rect);
          } else {
            applyBlackout(ctx, rect, label);
          }
        }

        // Export sanitized image and immediately clean up
        const sanitizedDataUrl = canvas.toDataURL('image/jpeg', 0.85);

        // Clear canvas context memory
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = 0;
        canvas.height = 0;

        resolve(sanitizedDataUrl);
      };

      img.onerror = (err) => reject(err);
      img.src = imageSource;
    });
  }

  // Export
  if (typeof window !== 'undefined') {
    window.__rakshakVisualRedactor = {
      applyBlackout,
      applyBlur,
      redactPixelBuffer,
      redactScreenImage
    };
  }

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      applyBlackout,
      applyBlur,
      redactPixelBuffer,
      redactScreenImage
    };
  }
})();
