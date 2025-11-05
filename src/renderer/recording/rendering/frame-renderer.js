
"use strict";

import { getRoundedRectPath } from "../../modules/canvas-utils.js";
import { drawBackground } from "./background-renderer.js";
import { getVideoFrameSize, clamp } from "../utils/general.js";
import { computeCanvasDimensions, updateCanvasDisplayScale } from "../utils/canvas.js";

export const ensureCanvasMetrics = (state, controls) => {
  const padding = clamp(
    Number(state.visualConfig?.padding) || 0,
    0,
    480,
  );
  const metrics = computeCanvasDimensions(
    state.frameSize,
    padding,
    Boolean(state.visualConfig?.withShadow),
    state.aspectRatio // Pass aspect ratio from state
  );
  if (
    controls.canvas.width !== metrics.canvasWidth ||
    controls.canvas.height !== metrics.canvasHeight
  ) {
    controls.canvas.width = metrics.canvasWidth;
    controls.canvas.height = metrics.canvasHeight;
  }
  updateCanvasDisplayScale(controls.canvas, metrics, controls.stage);
  state.metrics = metrics;
};

export const renderFrame = (
  timestamp, 
  state, 
  controls, 
  autoZoomEngine,
  scheduleOverlaySync,
  currentPreferences
) => {
  if (!state.isPreviewActive || !controls.canvas) {
    return;
  }

  const ctx = controls.canvas.getContext("2d");
  const video = controls.video;
  if (!ctx || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
    state.animationHandle = window.requestAnimationFrame((ts) => 
      renderFrame(ts, state, controls, autoZoomEngine, scheduleOverlaySync, currentPreferences)
    );
    return;
  }

  const frameSize = getVideoFrameSize(video);
  const frameChanged =
    frameSize.width !== state.frameSize.width ||
    frameSize.height !== state.frameSize.height;

  if (frameChanged) {
    state.frameSize = frameSize;
    autoZoomEngine.setFrameSize(frameSize.width, frameSize.height);
    scheduleOverlaySync();
  }

  ensureCanvasMetrics(state, controls);
  const metrics = state.metrics;

  autoZoomEngine.update(timestamp);

  ctx.save();
  ctx.clearRect(0, 0, controls.canvas.width, controls.canvas.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  drawBackground(ctx, metrics, state.visualConfig);

  if (state.visualConfig.withShadow) {
    ctx.save();
    ctx.fillStyle = "rgba(11, 15, 34, 0.01)";
    ctx.shadowColor = "rgba(8, 12, 32, 0.55)";
    ctx.shadowBlur = metrics.shadowBlur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = metrics.shadowOffsetY;
    getRoundedRectPath(
      ctx,
      metrics.drawX,
      metrics.drawY,
      metrics.baseWidth,
      metrics.baseHeight,
      metrics.cornerRadius,
    );
    ctx.fill();
    ctx.restore();
  }

  const viewport = autoZoomEngine.getViewport();
  let srcRect = { ...viewport.sourceRect };

  const cropMinX = metrics.sourceOffsetX || 0;
  const cropMinY = metrics.sourceOffsetY || 0;
  const cropWidth =
    metrics.sourceWidth && metrics.sourceWidth > 0
      ? metrics.sourceWidth
      : state.frameSize.width;
  const cropHeight =
    metrics.sourceHeight && metrics.sourceHeight > 0
      ? metrics.sourceHeight
      : state.frameSize.height;

  const targetRatio = metrics.targetAspectRatio;
  if (targetRatio) {
    const safeHeight = Math.max(1, srcRect.height);
    const currentRatio = srcRect.width / safeHeight;
    if (Math.abs(currentRatio - targetRatio) > 0.0001) {
      if (currentRatio > targetRatio) {
        const desiredWidth = safeHeight * targetRatio;
        const delta = srcRect.width - desiredWidth;
        srcRect.x += delta / 2;
        srcRect.width = Math.max(1, desiredWidth);
      } else {
        const desiredHeight = srcRect.width / targetRatio;
        const delta = srcRect.height - desiredHeight;
        srcRect.y += delta / 2;
        srcRect.height = Math.max(1, desiredHeight);
      }
    }
  }

  const maxAlignedX = cropMinX + cropWidth - srcRect.width;
  const maxAlignedY = cropMinY + cropHeight - srcRect.height;

  if (maxAlignedX < cropMinX) {
    srcRect.x = cropMinX;
    srcRect.width = cropWidth;
  } else {
    srcRect.x = clamp(srcRect.x, cropMinX, maxAlignedX);
  }

  if (maxAlignedY < cropMinY) {
    srcRect.y = cropMinY;
    srcRect.height = cropHeight;
  } else {
    srcRect.y = clamp(srcRect.y, cropMinY, maxAlignedY);
  }

  // Calculate drawing position with aspect ratio adjustment
  const drawPosX = metrics.drawX + metrics.contentOffsetX;
  const drawPosY = metrics.drawY + metrics.contentOffsetY;

  ctx.save();
  getRoundedRectPath(
    ctx,
    metrics.drawX,
    metrics.drawY,
    metrics.baseWidth,
    metrics.baseHeight,
    metrics.cornerRadius,
  );
  ctx.clip();

  // Draw video content at adjusted position
  ctx.drawImage(
    video,
    srcRect.x,
    srcRect.y,
    srcRect.width,
    srcRect.height,
    drawPosX,
    drawPosY,
    metrics.contentWidth,
    metrics.contentHeight,
  );
  ctx.restore();
  ctx.restore();

  if (controls.indicator && currentPreferences.showIndicator) {
    if (state.pointerInsideFrame) {
      const snapshot = autoZoomEngine.getSnapshot();
      const displayRect = controls.canvas.getBoundingClientRect();
      const scaleX = metrics.canvasWidth > 0 ? displayRect.width / metrics.canvasWidth : 1;
      const scaleY = metrics.canvasHeight > 0 ? displayRect.height / metrics.canvasHeight : 1;
      const frameCursorX = snapshot.cursor.x * state.frameSize.width;
      const frameCursorY = snapshot.cursor.y * state.frameSize.height;
      const normalizedCursorX =
        cropWidth > 0
          ? clamp((frameCursorX - cropMinX) / cropWidth, 0, 1)
          : 0.5;
      const normalizedCursorY =
        cropHeight > 0
          ? clamp((frameCursorY - cropMinY) / cropHeight, 0, 1)
          : 0.5;
      const cursorX =
        drawPosX + normalizedCursorX * metrics.contentWidth;
      const cursorY =
        drawPosY + normalizedCursorY * metrics.contentHeight;
      const indicatorWidth = controls.indicator.offsetWidth || 24;
      const indicatorHeight = controls.indicator.offsetHeight || 24;
      const translateX =
        displayRect.left + cursorX * scaleX - indicatorWidth / 2;
      const translateY =
        displayRect.top + cursorY * scaleY - indicatorHeight / 2;
      controls.indicator.style.transform = `translate(${translateX}px, ${translateY}px)`;
    }
  }

  state.animationHandle = window.requestAnimationFrame((ts) => 
    renderFrame(ts, state, controls, autoZoomEngine, scheduleOverlaySync, currentPreferences)
  );
};
