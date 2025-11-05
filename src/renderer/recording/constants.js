
"use strict";

export const ASPECT_RATIOS = [
  { label: "Original", value: "original", ratio: null },
  { label: "16:9 (Widescreen)", value: "16:9", ratio: 16 / 9 },
  { label: "4:3 (Standard)", value: "4:3", ratio: 4 / 3 },
  { label: "1:1 (Square)", value: "1:1", ratio: 1 },
  { label: "9:16 (Vertical)", value: "9:16", ratio: 9 / 16 },
  { label: "21:9 (Ultrawide)", value: "21:9", ratio: 21 / 9 }
];

export const PREFERENCES_KEY = "cleanshot:cursor-zoom-preferences";
export const MAX_PREVIEW_WIDTH = 980;
export const MAX_PREVIEW_HEIGHT = 560;

export const MIME_TYPE_ORDER = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
];

export const EASE_OPTIONS = [
  { label: "Ease-in-out", value: "ease-in-out" },
  { label: "Ease-in", value: "ease-in" },
  { label: "Ease-out", value: "ease-out" },
  { label: "Linear", value: "linear" },
];

export const DEFAULT_GRADIENT_ANGLE = 135;
