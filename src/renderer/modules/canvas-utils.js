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

  const sampleInset = (offset) => {
    const sampleSize = 1;
    const imageData = ctx.getImageData(
      offset,
      offset,
      sampleSize,
      sampleSize,
    );
    return imageData?.data?.[3] ?? 0;
  };

  for (let inset = 1; inset <= maxInset; inset += 1) {
    const alpha = sampleInset(inset);
    if (alpha >= 254) {
      return Math.max(0, inset - 1);
    }
  }

  return 0;
};

const drawRoundedImage = (ctx, image, dx, dy, dWidth, dHeight, radius) => {
  if (!image) {
    return;
  }

  const dpr = window.devicePixelRatio || 1;
  const offscreen = document.createElement("canvas");
  offscreen.width = Math.max(1, Math.round(dWidth * dpr));
  offscreen.height = Math.max(1, Math.round(dHeight * dpr));

  const offctx = offscreen.getContext("2d", {
    alpha: true,
    willReadFrequently: false,
  });

  if (!offctx) {
    ctx.save();
    getRoundedRectPath(ctx, dx, dy, dWidth, dHeight, radius);
    ctx.clip();
    ctx.drawImage(image, dx, dy, dWidth, dHeight);
    ctx.restore();
    return;
  }

  offctx.imageSmoothingEnabled = true;
  offctx.imageSmoothingQuality = "high";
  offctx.drawImage(image, 0, 0, dWidth, dHeight);

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
