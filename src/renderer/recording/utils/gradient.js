
"use strict";

import { DEFAULT_GRADIENT_ANGLE } from "../constants.js";

export const buildGradient = (ctx, width, height) => {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#141932");
  gradient.addColorStop(1, "#090b1b");
  return gradient;
};

export const normalizeColorStops = (input) => {
  // Accept: string (single color or comma-separated), or array of strings
  if (!input) {
    return [];
  }
  if (Array.isArray(input)) {
    return input
      .map((c) => (typeof c === "string" ? c.trim() : ""))
      .filter(Boolean);
  }
  if (typeof input === "string") {
    // Allow comma-separated list
    const parts = input.split(",").map((c) => c.trim()).filter(Boolean);
    return parts.length ? parts : [];
  }
  return [];
};

export const resolveGradientType = (visualConfig) => {
  const t = String(visualConfig?.backgroundGradientType || "").toLowerCase();
  return t === "radial" ? "radial" : "linear";
};

export const clampAngle = (deg) => {
  const n = Number.isFinite(deg) ? Number(deg) : DEFAULT_GRADIENT_ANGLE;
  // Normalize angle to [0, 360)
  return ((n % 360) + 360) % 360;
};

export const createLinearGradientAtAngle = (ctx, width, height, angleDeg, stops) => {
  // Convert degrees to radians and compute line endpoints mapped to rect
  const angle = (clampAngle(angleDeg) * Math.PI) / 180;
  // Compute unit vector
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  // Map to rectangle by taking center and extending to edges based on direction
  const cx = width / 2;
  const cy = height / 2;
  // Maximum half-diagonal to cover rectangle
  const halfDiag = Math.sqrt(cx * cx + cy * cy);
  const x0 = cx - ux * halfDiag;
  const y0 = cy - uy * halfDiag;
  const x1 = cx + ux * halfDiag;
  const y1 = cy + uy * halfDiag;

  const grad = ctx.createLinearGradient(x0, y0, x1, y1);
  const count = stops.length;
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    grad.addColorStop(t, stops[i]);
  }
  return grad;
};

export const createRadialGradientCentered = (ctx, width, height, stops) => {
  const cx = width / 2;
  const cy = height / 2;
  // Radius large enough to encompass rectangle corners
  const radius = Math.sqrt(cx * cx + cy * cy);
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  const count = stops.length;
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0 : i / (count - 1);
    grad.addColorStop(t, stops[i]);
  }
  return grad;
};
