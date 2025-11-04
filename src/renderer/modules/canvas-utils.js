"use strict";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const getRoundedRectPath = (ctx, x, y, width, height, radius) => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

// REPLACED with the more robust version used in renderer/renderer.js
const detectFringeInset = (ctx, width, height, cornerRadius) => {
  if (width <= 6 || height <= 6 || cornerRadius <= 0) {
    return 0;
  }

const maxInset = Math.min(
    24,
    Math.floor(Math.min(width, height) * 0.08),
    Math.floor(cornerRadius),
  );

if (maxInset <= 1) {
    return 0;
  }

const sampleSize = Math.min(Math.min(width, height), maxInset * 2 + 4);

const analyzeCorner = (corner) => {
    const startX = corner === "tr" || corner === "br" ? Math.max(0, width - sampleSize) : 0;
    const startY = corner === "bl" || corner === "br" ? Math.max(0, height - sampleSize) : 0;
    const sampleWidth = Math.min(sampleSize, width - startX);
    const sampleHeight = Math.min(sampleSize, height - startY);

if (sampleWidth <= 2 || sampleHeight <= 2) {
      return 0;
    }

const imageData = ctx.getImageData(startX, startY, sampleWidth, sampleHeight);
    const { data, width: stride, height: patchHeight } = imageData;
    const limit = Math.min(maxInset, Math.min(stride, patchHeight) - 1);

if (limit <= 1) {
      return 0;
    }

const mapCoords = (offset) => {
      switch (corner) {
        case "tl":
          return { x: Math.min(stride - 1, offset), y: Math.min(patchHeight - 1, offset) };
        case "tr":
          return { x: Math.max(0, stride - 1 - offset), y: Math.min(patchHeight - 1, offset) };
        case "bl":
          return { x: Math.min(stride - 1, offset), y: Math.max(0, patchHeight - 1 - offset) };
        case "br":
          return { x: Math.max(0, stride - 1 - offset), y: Math.max(0, patchHeight - 1 - offset) };
        default:
          return { x: 0, y: 0 };
      }
    };

const cornerCoords = mapCoords(0);
    const cornerIndex = (cornerCoords.y * stride + cornerCoords.x) * 4;
    const cornerAlpha = data[cornerIndex + 3];
    const cornerBrightness =
      (data[cornerIndex] + data[cornerIndex + 1] + data[cornerIndex + 2]) / 3;

if (cornerAlpha < 200 || cornerBrightness > 48) {
      return 0;
    }

const referenceOffset = Math.min(limit, Math.max(1, Math.floor(limit * 0.85)));
    const referenceCoords = mapCoords(referenceOffset);
    const referenceIndex = (referenceCoords.y * stride + referenceCoords.x) * 4;
    const referenceAlpha = data[referenceIndex + 3];
    const referenceBrightness =
      (data[referenceIndex] + data[referenceIndex + 1] + data[referenceIndex + 2]) / 3;

const baselineDelta =
      Math.abs(data[cornerIndex] - data[referenceIndex]) +
      Math.abs(data[cornerIndex + 1] - data[referenceIndex + 1]) +
      Math.abs(data[cornerIndex + 2] - data[referenceIndex + 2]);

if (referenceAlpha > 230 && baselineDelta < 36 && Math.abs(referenceBrightness - cornerBrightness) < 12) {
      return 0;
    }

for (let offset = 1; offset <= limit; offset += 1) {
      const coords = mapCoords(offset);
      const index = (coords.y * stride + coords.x) * 4;
      const alpha = data[index + 3];

if (alpha < 200) {
        continue;
      }

const brightness = (data[index] + data[index + 1] + data[index + 2]) / 3;
      const delta =
        Math.abs(data[index] - data[cornerIndex]) +
        Math.abs(data[index + 1] - data[cornerIndex + 1]) +
        Math.abs(data[index + 2] - data[cornerIndex + 2]);

if (delta > 42 || Math.abs(brightness - cornerBrightness) > 16) {
        return offset;
      }
    }

return limit;
  };

const samples = ["tl", "tr", "bl", "br"]
    .map((corner) => analyzeCorner(corner))
    .filter((value) => Number.isFinite(value) && value > 0);

return samples.length ? Math.max(...samples) : 0;
};

// REPLACED with the more robust version used in renderer/renderer.js
const drawRoundedImage = (ctx, image, dx, dy, dWidth, dHeight, radius) => {
  if (!image) {
    return;
  }

const fallback = () => {
    ctx.save();
    getRoundedRectPath(ctx, dx, dy, dWidth, dHeight, radius);
    ctx.clip();
    ctx.drawImage(image, dx, dy, dWidth, dHeight);
    ctx.restore();
  };

const offscreen = document.createElement("canvas");
  offscreen.width = Math.max(1, Math.round(dWidth));
  offscreen.height = Math.max(1, Math.round(dHeight));
  const offctx = offscreen.getContext("2d");
  if (!offctx) {
    fallback();
    return;
  }

offctx.imageSmoothingEnabled = true;
  offctx.imageSmoothingQuality = "high";
  offctx.drawImage(image, 0, 0, dWidth, dHeight);

// Dynamically trim any OS-provided rounded-corner fringe before masking.
  const dpr = window.devicePixelRatio || 1;
  const baseTrim = Math.max(1, Math.round(dpr));
  const detectedTrim = detectFringeInset(offctx, offscreen.width, offscreen.height, radius);
  const trim = Math.min(
    Math.max(baseTrim, detectedTrim),
    Math.floor(Math.min(offscreen.width, offscreen.height) / 2),
  );

const maskX = trim;
  const maskY = trim;
  const maskW = Math.max(1, dWidth - trim * 2);
  const maskH = Math.max(1, dHeight - trim * 2);
  const maskRadius = Math.max(0, radius - Math.max(0, Math.round(trim * 0.5)));

offctx.globalCompositeOperation = "destination-in";
  getRoundedRectPath(offctx, maskX, maskY, maskW, maskH, maskRadius);
  offctx.fillStyle = "#fff";
  offctx.fill();
  offctx.globalCompositeOperation = "source-over";

ctx.drawImage(offscreen, dx, dy);
};

const drawCoverImage = (ctx, image, width, height) => {
  if (!image) {
    return;
  }

  const imageRatio = image.width / image.height;
  const canvasRatio = width / height;

  let drawWidth = width;
  let drawHeight = height;
  let offsetX = 0;
  let offsetY = 0;

  if (imageRatio > canvasRatio) {
    drawHeight = height;
    drawWidth = imageRatio * drawHeight;
    offsetX = (width - drawWidth) / 2;
  } else {
    drawWidth = width;
    drawHeight = drawWidth / imageRatio;
    offsetY = (height - drawHeight) / 2;
  }

  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
};

export {
  clamp,
  getRoundedRectPath,
  detectFringeInset,
  drawRoundedImage,
  drawCoverImage,
};
