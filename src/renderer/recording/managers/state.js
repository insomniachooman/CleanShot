
"use strict";

import { resolveMimeType, clamp } from "../utils/general.js";
import { computeCanvasDimensions } from "../utils/canvas.js";

export const createState = (initialVisualConfig) => {
  return {
    sources: [],
    selectedSourceId: null,
    mediaStream: null,
    mediaRecorder: null,
    recordedChunks: [],
    recordingMimeType: resolveMimeType(),
    isRecording: false,
    isPreviewActive: false,
    animationHandle: null,
    frameSize: { width: 1, height: 1 },
    aspectRatio: "original",
    visualConfig: initialVisualConfig,
    metrics: computeCanvasDimensions(
      { width: 1, height: 1 },
      clamp(Number(initialVisualConfig.padding) || 0, 0, 480),
      Boolean(initialVisualConfig.withShadow),
      "original"
    ),
    lastPointer: null,
    pointerInsideFrame: false,
    previewHiddenByRecording: false,
    overlay: {
      supported: Boolean(window.cleanShot?.startCursorOverlay),
      active: false,
      busy: false,
      needsResync: false,
      lastPayload: null,
    },
    overlayListenerCleanup: null,
  };
};

export const getInitialVisualConfig = () => {
  return window.cleanShotVisualState?.getSnapshot?.() || {
    backgroundMode: "color",
    backgroundColor: "#0f172a",
    padding: 80,
    withShadow: true,
    customImage: null,
    desktopImage: null,
  };
};
