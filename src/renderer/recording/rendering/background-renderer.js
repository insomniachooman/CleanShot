
"use strict";

import { 
  drawCoverImage 
} from "../../modules/canvas-utils.js";
import {
  buildGradient,
  normalizeColorStops,
  resolveGradientType,
  createLinearGradientAtAngle,
  createRadialGradientCentered,
} from "../utils/gradient.js";
import { DEFAULT_GRADIENT_ANGLE } from "../constants.js";

export const drawBackground = (ctx, metrics, visualConfig) => {
  const {
    canvasWidth,
    canvasHeight,
  } = metrics;

  switch (visualConfig.backgroundMode) {
    case "transparent":
      ctx.clearRect(0, 0, canvasWidth, canvasHeight);
      break;
    case "color": {
      // New: allow single color OR multiple stops (comma-separated or array)
      const stops =
        normalizeColorStops(visualConfig.backgroundColors) ||
        normalizeColorStops(visualConfig.backgroundColor);

      if (stops.length > 1) {
        const type = resolveGradientType(visualConfig); // "linear" (default) or "radial"
        let fill;
        if (type === "radial") {
          fill = createRadialGradientCentered(ctx, canvasWidth, canvasHeight, stops);
        } else {
          const angle = Number(visualConfig.backgroundAngle);
          fill = createLinearGradientAtAngle(
            ctx,
            canvasWidth,
            canvasHeight,
            Number.isFinite(angle) ? angle : DEFAULT_GRADIENT_ANGLE,
            stops,
          );
        }
        ctx.fillStyle = fill;
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      } else {
        // Backward-compatible: single solid color string
        ctx.fillStyle = (stops[0] || visualConfig.backgroundColor || "#0f172a");
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }
      break;
    }
    case "desktop": {
      const image = visualConfig.desktopImage;
      if (image) {
        drawCoverImage(ctx, image, canvasWidth, canvasHeight);
      } else {
        ctx.fillStyle = buildGradient(ctx, canvasWidth, canvasHeight);
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }
      break;
    }
    case "image": {
      const image = visualConfig.customImage;
      if (image) {
        drawCoverImage(ctx, image, canvasWidth, canvasHeight);
      } else {
        ctx.fillStyle = buildGradient(ctx, canvasWidth, canvasHeight);
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      }
      break;
    }
    default:
      ctx.fillStyle = buildGradient(ctx, canvasWidth, canvasHeight);
      ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      break;
  }
};
