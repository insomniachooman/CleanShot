"use strict";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const computeLuma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

const createFocusDetector = (options = {}) => {
  const analysisCanvas = document.createElement("canvas");
  const ctx = analysisCanvas.getContext("2d", { willReadFrequently: true });
  const sampleSize = clamp(Number(options.sampleSize) || 220, 120, 640);
  const edgeThreshold = clamp(Number(options.edgeThreshold) || 18, 6, 60);
  const minElementSize = clamp(Number(options.minElementSize) || 72, 24, 360);

  const detectEdge = (imageData, settings) => {
    const {
      axis,
      forward,
      origin,
      maxSteps,
      width,
      height,
      stride,
      brightness,
    } = settings;

    const stepSign = forward ? 1 : -1;
    let lastBrightness = brightness(origin.x, origin.y);
    let consistent = 0;

    for (let step = 1; step < maxSteps; step += 1) {
      const samplePos =
        axis === "x"
          ? {
            x: clamp(origin.x + step * stepSign, 0, width - 1),
            y: origin.y,
          }
          : {
            x: origin.x,
            y: clamp(origin.y + step * stepSign, 0, height - 1),
          };

      const nextBrightness = brightness(samplePos.x, samplePos.y);
      const delta = Math.abs(nextBrightness - lastBrightness);

      if (delta > edgeThreshold) {
        consistent += 1;
      } else {
        consistent = Math.max(consistent - 1, 0);
      }

      if (consistent >= 3) {
        const offset = step - 2;
        const candidate =
          axis === "x"
            ? origin.x + offset * stepSign
            : origin.y + offset * stepSign;
        return clamp(candidate, 0, axis === "x" ? width - 1 : height - 1);
      }

      lastBrightness = nextBrightness;
    }

    return forward
      ? axis === "x"
        ? width - 1
        : height - 1
      : axis === "x"
        ? 0
        : 0;
  };

  const analyze = async (payload = {}) => {
    const { frame, point, requestedZoom } = payload;
    if (!frame || typeof frame.videoWidth !== "number" || !point) {
      return null;
    }

    const frameWidth = frame.videoWidth;
    const frameHeight = frame.videoHeight;
    if (!frameWidth || !frameHeight) {
      return null;
    }

    const cursorX = clamp(Math.round(point.x), 0, frameWidth - 1);
    const cursorY = clamp(Math.round(point.y), 0, frameHeight - 1);

    const regionHalfSize = Math.round(sampleSize / 2);
    const regionLeft = clamp(cursorX - regionHalfSize, 0, frameWidth - sampleSize);
    const regionTop = clamp(
      cursorY - regionHalfSize,
      0,
      frameHeight - sampleSize,
    );

    analysisCanvas.width = sampleSize;
    analysisCanvas.height = sampleSize;
    ctx.clearRect(0, 0, sampleSize, sampleSize);
    ctx.drawImage(
      frame,
      regionLeft,
      regionTop,
      sampleSize,
      sampleSize,
      0,
      0,
      sampleSize,
      sampleSize,
    );

    const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
    const { data } = imageData;

    const stride = 4;
    const brightness = (x, y) => {
      const index = (y * sampleSize + x) * stride;
      const r = data[index] ?? 0;
      const g = data[index + 1] ?? 0;
      const b = data[index + 2] ?? 0;
      return computeLuma(r, g, b);
    };

    const localX = clamp(cursorX - regionLeft, 0, sampleSize - 1);
    const localY = clamp(cursorY - regionTop, 0, sampleSize - 1);

    const leftEdge = detectEdge(imageData, {
      axis: "x",
      forward: false,
      origin: { x: localX, y: localY },
      maxSteps: sampleSize,
      width: sampleSize,
      height: sampleSize,
      stride,
      brightness,
    });

    const rightEdge = detectEdge(imageData, {
      axis: "x",
      forward: true,
      origin: { x: localX, y: localY },
      maxSteps: sampleSize,
      width: sampleSize,
      height: sampleSize,
      stride,
      brightness,
    });

    const topEdge = detectEdge(imageData, {
      axis: "y",
      forward: false,
      origin: { x: localX, y: localY },
      maxSteps: sampleSize,
      width: sampleSize,
      height: sampleSize,
      stride,
      brightness,
    });

    const bottomEdge = detectEdge(imageData, {
      axis: "y",
      forward: true,
      origin: { x: localX, y: localY },
      maxSteps: sampleSize,
      width: sampleSize,
      height: sampleSize,
      stride,
      brightness,
    });

    const detectedWidth = Math.max(rightEdge - leftEdge, minElementSize);
    const detectedHeight = Math.max(bottomEdge - topEdge, minElementSize);

    const estimatedZoomX = frameWidth / Math.max(detectedWidth * 1.1, 1);
    const estimatedZoomY = frameHeight / Math.max(detectedHeight * 1.1, 1);
    const recommendedZoom = clamp(
      Math.min(estimatedZoomX, estimatedZoomY, requestedZoom * 1.4),
      1,
      3,
    );

    const normalizedAnchor = {
      x: clamp((regionLeft + (leftEdge + rightEdge) / 2) / frameWidth, 0, 1),
      y: clamp((regionTop + (topEdge + bottomEdge) / 2) / frameHeight, 0, 1),
    };

    return {
      zoom: recommendedZoom,
      anchor: normalizedAnchor,
    };
  };

  return {
    analyze,
  };
};

export { createFocusDetector };
