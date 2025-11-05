
"use strict";

import {
  MAX_PREVIEW_WIDTH,
  MAX_PREVIEW_HEIGHT,
  ASPECT_RATIOS,
} from "../constants.js";
import { clamp } from "../utils/general.js";

const ASPECT_RATIO_EPSILON = 0.0001;

const resolveAspectRatioEntry = (aspectRatioValue) =>
  ASPECT_RATIOS.find((ratio) => ratio.value === aspectRatioValue) || null;

const computeCroppedContent = (frameWidth, frameHeight, aspectRatioValue) => {
  const width = Math.max(1, frameWidth || 1);
  const height = Math.max(1, frameHeight || 1);
  const selected = resolveAspectRatioEntry(aspectRatioValue);

  if (!selected || selected.ratio === null) {
    return {
      ratio: null,
      contentWidth: width,
      contentHeight: height,
      sourceOffsetX: 0,
      sourceOffsetY: 0,
    };
  }

  const targetRatio = selected.ratio;
  const currentRatio = width / height;

  if (Math.abs(currentRatio - targetRatio) < ASPECT_RATIO_EPSILON) {
    return {
      ratio: targetRatio,
      contentWidth: width,
      contentHeight: height,
      sourceOffsetX: 0,
      sourceOffsetY: 0,
    };
  }

  if (currentRatio > targetRatio) {
    const contentWidth = Math.max(1, Math.round(height * targetRatio));
    const offsetX = Math.max(0, Math.round((width - contentWidth) / 2));
    return {
      ratio: targetRatio,
      contentWidth,
      contentHeight: height,
      sourceOffsetX: offsetX,
      sourceOffsetY: 0,
    };
  }

  const contentHeight = Math.max(1, Math.round(width / targetRatio));
  const offsetY = Math.max(0, Math.round((height - contentHeight) / 2));
  return {
    ratio: targetRatio,
    contentWidth: width,
    contentHeight,
    sourceOffsetX: 0,
    sourceOffsetY: offsetY,
  };
};

export const computeCanvasDimensions = (
  frameSize,
  padding,
  withShadow,
  aspectRatioValue = "original",
) => {
  const baseWidth = frameSize.width || 1;
  const baseHeight = frameSize.height || 1;
  const {
    ratio: targetAspectRatio,
    contentWidth,
    contentHeight,
    sourceOffsetX,
    sourceOffsetY,
  } = computeCroppedContent(baseWidth, baseHeight, aspectRatioValue);

  const cornerRadius = 26;
  const shadowEnabled = Boolean(withShadow);
  const shadowBlur = shadowEnabled
    ? Math.min(90, Math.max(24, padding * 0.65))
    : 0;
  const shadowOffsetY = shadowEnabled
    ? Math.min(70, Math.round(padding * 0.55))
    : 0;
  const shadowPadX = shadowEnabled ? shadowBlur : 0;
  const shadowPadYTop = shadowEnabled ? shadowBlur : 0;
  const shadowPadYBottom = shadowEnabled ? shadowBlur + shadowOffsetY : 0;

  const canvasWidth = contentWidth + padding * 2 + shadowPadX * 2;
  const canvasHeight =
    contentHeight + padding * 2 + shadowPadYTop + shadowPadYBottom;

  const drawX = padding + shadowPadX;
  const drawY = padding + shadowPadYTop;

  return {
    canvasWidth,
    canvasHeight,
    drawX,
    drawY,
    shadowBlur,
    shadowOffsetY,
    baseWidth: contentWidth,
    baseHeight: contentHeight,
    contentWidth,
    contentHeight,
    contentOffsetX: 0,
    contentOffsetY: 0,
    sourceOffsetX,
    sourceOffsetY,
    sourceWidth: contentWidth,
    sourceHeight: contentHeight,
    targetAspectRatio,
    cornerRadius,
  };
};

export const updateCanvasDisplayScale = (canvas, metrics, container) => {
  if (!canvas || !metrics) {
    return;
  }
  const rect =
    typeof container?.getBoundingClientRect === "function"
      ? container.getBoundingClientRect()
      : null;
  const availW = Math.max(
    1,
    Math.min(MAX_PREVIEW_WIDTH, Math.floor(rect?.width || MAX_PREVIEW_WIDTH)),
  );
  const availH = Math.max(
    1,
    Math.min(
      MAX_PREVIEW_HEIGHT,
      Math.floor(rect?.height || MAX_PREVIEW_HEIGHT),
    ),
  );

  const scale = Math.min(
    1,
    availW / metrics.canvasWidth,
    availH / metrics.canvasHeight,
  );

  canvas.style.width = `${Math.round(metrics.canvasWidth * scale)}px`;
  canvas.style.height = `${Math.round(metrics.canvasHeight * scale)}px`;
};

export const mapPointerToFrame = (event, canvas, frameSize, metrics) => {
  if (!canvas || !metrics) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width > 0 ? rect.width / canvas.width : 1;
  const scaleY = canvas.height > 0 ? rect.height / canvas.height : 1;
  const offsetX = (event.clientX - rect.left) / scaleX;
  const offsetY = (event.clientY - rect.top) / scaleY;

  const canvasX = offsetX - metrics.drawX - (metrics.contentOffsetX || 0);
  const canvasY = offsetY - metrics.drawY - (metrics.contentOffsetY || 0);

  if (
    canvasX < 0 ||
    canvasX > metrics.contentWidth ||
    canvasY < 0 ||
    canvasY > metrics.contentHeight
  ) {
    return null;
  }

  const normalizedX = canvasX / Math.max(1, metrics.contentWidth);
  const normalizedY = canvasY / Math.max(1, metrics.contentHeight);

  const sourceWidth =
    metrics.sourceWidth && metrics.sourceWidth > 0
      ? metrics.sourceWidth
      : frameSize.width;
  const sourceHeight =
    metrics.sourceHeight && metrics.sourceHeight > 0
      ? metrics.sourceHeight
      : frameSize.height;
  const sourceOffsetX = metrics.sourceOffsetX || 0;
  const sourceOffsetY = metrics.sourceOffsetY || 0;

  return {
    x: clamp(
      sourceOffsetX + normalizedX * sourceWidth,
      0,
      frameSize.width,
    ),
    y: clamp(
      sourceOffsetY + normalizedY * sourceHeight,
      0,
      frameSize.height,
    ),
  };
};
