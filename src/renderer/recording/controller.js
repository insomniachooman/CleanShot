"use strict";

import { createCursorAutoZoomEngine, buildSettings } from "./auto-zoom-engine.js";
import { createFocusDetector } from "./focus-detector.js";
import {
  drawCoverImage,
  drawRoundedImage,
  getRoundedRectPath,
} from "../modules/canvas-utils.js";

const PREFERENCES_KEY = "cleanshot:cursor-zoom-preferences";
const MAX_PREVIEW_WIDTH = 980;
const MAX_PREVIEW_HEIGHT = 560;

const MIME_TYPE_ORDER = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
];

const easeOptions = [
  { label: "Ease-in-out", value: "ease-in-out" },
  { label: "Ease-in", value: "ease-in" },
  { label: "Ease-out", value: "ease-out" },
  { label: "Linear", value: "linear" },
];

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const readPreferences = () => {
  try {
    const raw = window.localStorage?.getItem(PREFERENCES_KEY);
    if (!raw) {
      return buildSettings();
    }
    const parsed = JSON.parse(raw);
    return buildSettings(parsed);
  } catch (_err) {
    return buildSettings();
  }
};

const writePreferences = (preferences) => {
  try {
    window.localStorage?.setItem(
      PREFERENCES_KEY,
      JSON.stringify(preferences ?? {}),
    );
  } catch (error) {
    console.warn("Failed to persist cursor zoom preferences", error);
  }
};

const resolveMimeType = () => {
  for (const candidate of MIME_TYPE_ORDER) {
    if (
      typeof window.MediaRecorder !== "undefined" &&
      MediaRecorder.isTypeSupported(candidate)
    ) {
      return candidate;
    }
  }
  return "video/webm";
};

const toArrayBufferLike = async (blob) => {
  if (!blob) {
    return null;
  }
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
};

const sanitizeFileName = (value, fallback) => {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  return value.replace(/[<>:"/\\|?*]/g, "").trim().slice(0, 120) || fallback;
};

const formatTimestampedName = () => {
  const now = new Date();
  const datePart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const timePart = `${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  return `CleanShot Recording ${datePart} ${timePart}.webm`;
};

const computeCanvasDimensions = (frameSize, padding, withShadow) => {
  const baseWidth = frameSize.width || 1;
  const baseHeight = frameSize.height || 1;
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

  const canvasWidth = baseWidth + padding * 2 + shadowPadX * 2;
  const canvasHeight = baseHeight + padding * 2 + shadowPadYTop + shadowPadYBottom;

  const drawX = padding + shadowPadX;
  const drawY = padding + shadowPadYTop;

  return {
    canvasWidth,
    canvasHeight,
    drawX,
    drawY,
    shadowBlur,
    shadowOffsetY,
    baseWidth,
    baseHeight,
    cornerRadius,
  };
};

const buildGradient = (ctx, width, height) => {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#141932");
  gradient.addColorStop(1, "#090b1b");
  return gradient;
};

const DEFAULT_GRADIENT_ANGLE = 135;

const normalizeColorStops = (input) => {
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

const resolveGradientType = (visualConfig) => {
  const t = String(visualConfig?.backgroundGradientType || "").toLowerCase();
  return t === "radial" ? "radial" : "linear";
};

const clampAngle = (deg) => {
  const n = Number.isFinite(deg) ? Number(deg) : DEFAULT_GRADIENT_ANGLE;
  // Normalize angle to [0, 360)
  return ((n % 360) + 360) % 360;
};

const createLinearGradientAtAngle = (ctx, width, height, angleDeg, stops) => {
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

const createRadialGradientCentered = (ctx, width, height, stops) => {
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

const updateCanvasDisplayScale = (canvas, metrics, container) => {
  if (!canvas || !metrics) {
    return;
  }
  // Prefer container bounds, fall back to preview caps.
  const rect = typeof container?.getBoundingClientRect === "function"
    ? container.getBoundingClientRect()
    : null;
  const availW = Math.max(1, Math.min(MAX_PREVIEW_WIDTH, Math.floor(rect?.width || MAX_PREVIEW_WIDTH)));
  const availH = Math.max(1, Math.min(MAX_PREVIEW_HEIGHT, Math.floor(rect?.height || MAX_PREVIEW_HEIGHT)));

  const scale = Math.min(
    1,
    availW / metrics.canvasWidth,
    availH / metrics.canvasHeight,
  );

  // Keep drawing buffer at device pixels; only size the CSS box.
  canvas.style.width = `${Math.round(metrics.canvasWidth * scale)}px`;
  canvas.style.height = `${Math.round(metrics.canvasHeight * scale)}px`;
};

const drawBackground = (ctx, metrics, visualConfig) => {
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

const getVideoFrameSize = (video) => ({
  width: Math.max(1, video?.videoWidth || 0),
  height: Math.max(1, video?.videoHeight || 0),
});

const mapPointerToFrame = (event, canvas, frameSize, metrics) => {
  if (!canvas) {
    return null;
  }
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width > 0 ? rect.width / canvas.width : 1;
  const scaleY = canvas.height > 0 ? rect.height / canvas.height : 1;
  const offsetX = (event.clientX - rect.left) / scaleX;
  const offsetY = (event.clientY - rect.top) / scaleY;

  const x = offsetX - metrics.drawX;
  const y = offsetY - metrics.drawY;

  return {
    x: clamp(x, 0, frameSize.width),
    y: clamp(y, 0, frameSize.height),
  };
};

const buildControls = () => ({
  stage: document.getElementById("recordingStage"),
  canvas: document.getElementById("recordingCanvas"),
  video: document.getElementById("recordingSourceVideo"),
  indicator: document.getElementById("cursorZoomIndicator"),
  sourceSelect: document.getElementById("recordingSourceSelect"),
  enableToggle: document.getElementById("cursorAutoZoomToggle"),
  modeRadios: Array.from(
    document.querySelectorAll('input[name="cursorZoomMode"]'),
  ),
  zoomSlider: document.getElementById("cursorZoomLevelSlider"),
  zoomValueLabel: document.getElementById("cursorZoomLevelValue"),
  durationInput: document.getElementById("cursorZoomDurationInput"),
  easingSelect: document.getElementById("cursorZoomEasing"),
  holdInput: document.getElementById("cursorZoomHoldInput"),
  detectElementsToggle: document.getElementById("cursorZoomDetectElementsToggle"),
  indicatorToggle: document.getElementById("cursorZoomIndicatorToggle"),
  followSlider: document.getElementById("cursorFollowSensitivitySlider"),
  followValueLabel: document.getElementById("cursorFollowSensitivityValue"),
  deadZoneInput: document.getElementById("cursorDeadZoneInput"),
  startBtn: document.getElementById("startRecordingBtn"),
  stopBtn: document.getElementById("stopRecordingBtn"),
  statusDisplay: document.getElementById("recordingStatus"),
});

const resolveModeFromControls = (modeRadios) => {
  const active = modeRadios.find((input) => input?.checked);
  return active ? active.value : "click_only";
};

const syncModeRadios = (modeRadios, nextValue) => {
  modeRadios.forEach((input) => {
    input.checked = input.value === nextValue;
  });
};

const renderEasingOptions = (selectEl) => {
  if (!selectEl) {
    return;
  }
  if (selectEl.options.length === easeOptions.length) {
    return;
  }
  selectEl.innerHTML = "";
  easeOptions.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    selectEl.appendChild(opt);
  });
};

/**
 * Keep the visual state of a .switch wrapper in sync with its checkbox state.
 * This mirrors renderer's shadow switch behavior so the handle slides when toggled.
 */
const setSwitchActive = (inputEl, active) => {
  if (!inputEl) {
    return;
  }
  const wrapper = inputEl.closest(".switch");
  if (wrapper) {
    wrapper.classList.toggle("is-active", Boolean(active));
  }
};

export const initializeRecordingController = (options = {}) => {
  const api = options.api || window.cleanShot;
  const controls = buildControls();
  const previewCanvas = options.previewCanvas || null;
  const previewStage = options.previewStage || null;
  const publishStatus =
    typeof options.onStatus === "function"
      ? options.onStatus
      : () => {};

  if (!controls.canvas || !controls.video) {
    console.warn("Recording controls unavailable; skipping auto-zoom initialization.");
    return null;
  }

  renderEasingOptions(controls.easingSelect);

  const preferences = readPreferences();
  let currentPreferences = preferences;
  let pointerInsideFrame = false;
  const autoZoomEngine = createCursorAutoZoomEngine({
    initialSettings: preferences,
  });

  const focusDetector = createFocusDetector();
  autoZoomEngine.setFocusResolver(async ({ point, requestedZoom }) => {
    if (
      !controls.video ||
      controls.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      return {
        zoom: requestedZoom,
        anchor: point,
      };
    }
    return focusDetector.analyze({
      frame: controls.video,
      point,
      requestedZoom,
    });
  });

  autoZoomEngine.setIndicatorEmitter((payload) => {
    if (!controls.indicator) {
      return;
    }
    if (!payload?.active || !pointerInsideFrame) {
      controls.indicator.style.opacity = "0";
      return;
    }
    const opacity = clamp(Number(payload.opacity) || 0.6, 0, 1);
    controls.indicator.style.opacity = `${opacity}`;
  });

  const initialVisualConfig =
    window.cleanShotVisualState?.getSnapshot?.() || {
      backgroundMode: "color",
      backgroundColor: "#0f172a",
      padding: 80,
      withShadow: true,
      customImage: null,
      desktopImage: null,
    };

  const state = {
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
    visualConfig: initialVisualConfig,
    metrics: computeCanvasDimensions(
      { width: 1, height: 1 },
      clamp(Number(initialVisualConfig.padding) || 0, 0, 480),
      Boolean(initialVisualConfig.withShadow),
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

  autoZoomEngine.setFrameSize(state.frameSize.width, state.frameSize.height);

  const updatePointerPresence = (inside) => {
    const next = Boolean(inside);
    pointerInsideFrame = next;
    state.pointerInsideFrame = next;
    if (!next) {
      state.lastPointer = null;
      if (controls.indicator) {
        controls.indicator.style.opacity = "0";
      }
    }
  };

  const buildOverlayPayload = () => {
    if (!state.overlay.supported) {
      return null;
    }
    if (!state.isPreviewActive) {
      return null;
    }
    if (!state.selectedSourceId) {
      return null;
    }
    const frameWidth = Math.max(0, Number(state.frameSize?.width) || 0);
    const frameHeight = Math.max(0, Number(state.frameSize?.height) || 0);
    if (frameWidth < 16 || frameHeight < 16) {
      return null;
    }

    const source =
      state.sources.find((entry) => entry.id === state.selectedSourceId) ||
      null;
    const inferredType =
      source?.type ||
      (String(state.selectedSourceId).startsWith("screen:") ? "screen" : "window");

    return {
      sourceId: state.selectedSourceId,
      sourceType: inferredType,
      displayId: source?.displayId || null,
      frameWidth,
      frameHeight,
    };
  };

  const performOverlaySync = async () => {
    if (!state.overlay.supported) {
      return;
    }

    const payload = buildOverlayPayload();
    if (!payload) {
      if (state.overlay.active) {
        try {
          await window.cleanShot?.stopCursorOverlay?.();
        } catch (error) {
          console.warn("Failed to stop cursor overlay session", error);
        }
      }
      state.overlay.active = false;
      state.overlay.lastPayload = null;
      return;
    }

    if (!state.overlay.active) {
      try {
        const result = await window.cleanShot?.startCursorOverlay?.(payload);
        if (result?.success) {
          state.overlay.active = true;
          state.overlay.lastPayload = payload;
          return;
        }
      } catch (error) {
        console.warn("Failed to start cursor overlay session", error);
      }
      state.overlay.active = false;
      state.overlay.lastPayload = null;
      return;
    }

    const last = state.overlay.lastPayload;
    const changed =
      !last ||
      last.sourceId !== payload.sourceId ||
      last.displayId !== payload.displayId ||
      last.sourceType !== payload.sourceType ||
      last.frameWidth !== payload.frameWidth ||
      last.frameHeight !== payload.frameHeight;

    if (!changed) {
      return;
    }

    try {
      const result = await window.cleanShot?.updateCursorOverlay?.(payload);
      if (result?.success) {
        state.overlay.lastPayload = payload;
        return;
      }
      if (result?.reason === "inactive") {
        state.overlay.active = false;
        state.overlay.lastPayload = null;
        state.overlay.needsResync = true;
        return;
      }
      state.overlay.active = false;
      state.overlay.lastPayload = null;
      state.overlay.needsResync = true;
    } catch (error) {
      console.warn("Failed to update cursor overlay session", error);
      state.overlay.active = false;
      state.overlay.lastPayload = null;
      state.overlay.needsResync = true;
    }
  };

  const scheduleOverlaySync = () => {
    if (!state.overlay.supported) {
      return;
    }
    if (state.overlay.busy) {
      state.overlay.needsResync = true;
      return;
    }
    state.overlay.busy = true;
    performOverlaySync()
      .catch((error) => {
        console.warn("Cursor overlay synchronization failed", error);
      })
      .finally(() => {
        state.overlay.busy = false;
        if (state.overlay.needsResync) {
          state.overlay.needsResync = false;
          scheduleOverlaySync();
        }
      });
  };

  const stopOverlaySession = async () => {
    if (!state.overlay.supported) {
      return;
    }
    state.overlay.needsResync = false;
    state.overlay.lastPayload = null;
    updatePointerPresence(false);
    try {
      await window.cleanShot?.stopCursorOverlay?.();
    } catch (error) {
      console.warn("Failed to stop cursor overlay session", error);
    }
    state.overlay.active = false;
  };

  const applyPreferencesToControls = (prefs) => {
    if (controls.enableToggle) {
      const checked = Boolean(prefs.enableAutoZoom);
      controls.enableToggle.checked = checked;
      // Sync the slider visual so the handle moves with the state.
      setSwitchActive(controls.enableToggle, checked);
    }
    if (controls.modeRadios?.length) {
      syncModeRadios(controls.modeRadios, prefs.zoomMode);
    }
    if (controls.zoomSlider) {
      controls.zoomSlider.value = String(prefs.zoomLevel);
      if (controls.zoomValueLabel) {
        controls.zoomValueLabel.textContent = `${Number(prefs.zoomLevel).toFixed(1)}x`;
      }
    }
    if (controls.durationInput) {
      controls.durationInput.value = String(prefs.animationDuration);
    }
    if (controls.holdInput) {
      controls.holdInput.value = String(prefs.holdDuration);
    }
    if (controls.easingSelect) {
      controls.easingSelect.value = prefs.easing;
    }
    if (controls.detectElementsToggle) {
      controls.detectElementsToggle.checked = Boolean(prefs.detectUiElements);
    }
    if (controls.indicatorToggle) {
      controls.indicatorToggle.checked = Boolean(prefs.showIndicator);
    }
    if (controls.followSlider) {
      controls.followSlider.value = String(prefs.followSensitivity);
      if (controls.followValueLabel) {
        controls.followValueLabel.textContent = `${Number(prefs.followSensitivity).toFixed(2)}`;
      }
    }
    if (controls.deadZoneInput) {
      controls.deadZoneInput.value = String(prefs.deadZoneRadius);
    }
  };

  const readPreferencesFromControls = () => {
    const nextPrefs = {
      enableAutoZoom: Boolean(controls.enableToggle?.checked),
      zoomMode: resolveModeFromControls(controls.modeRadios || []),
      zoomLevel: clamp(Number(controls.zoomSlider?.value) || 2, 1, 3),
      animationDuration: clamp(Number(controls.durationInput?.value) || 400, 200, 1000),
      holdDuration: clamp(Number(controls.holdInput?.value) || 800, 0, 4000),
      easing: controls.easingSelect?.value || "ease-in-out",
      detectUiElements: Boolean(controls.detectElementsToggle?.checked),
      showIndicator: Boolean(controls.indicatorToggle?.checked),
      followSensitivity: clamp(Number(controls.followSlider?.value) || 0.7, 0.1, 1),
      deadZoneRadius: clamp(Number(controls.deadZoneInput?.value) || 100, 0, 600),
    };
    return buildSettings(nextPrefs);
  };

  const applyPreferences = (nextPrefs, options = {}) => {
    applyPreferencesToControls(nextPrefs);
    if (!options.skipWrite) {
      writePreferences(nextPrefs);
    }
    autoZoomEngine.applySettings(nextPrefs);
    currentPreferences = nextPrefs;
    if (!nextPrefs.showIndicator && controls.indicator) {
      controls.indicator.style.opacity = "0";
    }
  };

  applyPreferencesToControls(preferences);
  autoZoomEngine.applySettings(preferences);

  const updateButtons = () => {
    if (controls.startBtn) {
      controls.startBtn.disabled =
        state.isRecording ||
        !state.selectedSourceId ||
        !controls.video ||
        !controls.canvas;
    }
    if (controls.stopBtn) {
      controls.stopBtn.disabled = !state.isRecording;
    }
  };

  const updateStatus = (message, tone = "neutral") => {
    if (controls.statusDisplay) {
      controls.statusDisplay.textContent = message || "";
      controls.statusDisplay.dataset.tone = tone;
    }
    publishStatus(message, tone);
  };

  const syncSources = (sources) => {
    state.sources = Array.isArray(sources) ? sources : [];
    if (!controls.sourceSelect) {
      return;
    }
    controls.sourceSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose a source to record";
    controls.sourceSelect.appendChild(placeholder);

    state.sources.forEach((source) => {
      const option = document.createElement("option");
      option.value = source.id;
      option.textContent = source.name || source.id;
      option.dataset.type = source.type || "";
      controls.sourceSelect.appendChild(option);
    });

    if (state.selectedSourceId) {
      controls.sourceSelect.value = state.selectedSourceId;
    } else {
      controls.sourceSelect.value = "";
    }

    updateButtons();
    scheduleOverlaySync();
  };

  const setActiveSource = (sourceId) => {
    state.selectedSourceId = sourceId || null;
    if (controls.sourceSelect && sourceId) {
      controls.sourceSelect.value = sourceId;
    }
    updateButtons();
    scheduleOverlaySync();
  };

  const releaseStream = () => {
    if (state.mediaStream) {
      state.mediaStream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (_err) {
          // ignore
        }
      });
    }
    state.mediaStream = null;
  };

  const teardownPreview = () => {
    if (state.animationHandle) {
      window.cancelAnimationFrame(state.animationHandle);
      state.animationHandle = null;
    }
    state.isPreviewActive = false;
    updatePointerPresence(false);
    stopOverlaySession();
    autoZoomEngine.cancelZoom();
    if (controls.stage) {
      controls.stage.classList.add("is-hidden");
      controls.stage.setAttribute("aria-hidden", "true");
    }
    if (controls.video) {
      controls.video.pause?.();
      controls.video.srcObject = null;
    }
    if (previewCanvas && state.previewHiddenByRecording) {
      previewCanvas.classList.remove("is-hidden");
    }
    if (previewStage) {
      previewStage.dataset.recording = "false";
    }
    state.previewHiddenByRecording = false;
  };

  const finalizeRecording = async () => {
    if (!state.recordedChunks.length) {
      updateStatus("Recording stopped.", "neutral");
      return;
    }

    const blob = new Blob(state.recordedChunks, {
      type: state.recordingMimeType,
    });

    try {
      const data = await toArrayBufferLike(blob);
      if (!data) {
        throw new Error("Unable to serialize recording.");
      }

      const payload = {
        data,
        mimeType: state.recordingMimeType,
        defaultPath: formatTimestampedName(),
      };

      if (typeof api?.saveVideo === "function") {
        await api.saveVideo(payload);
        updateStatus("Recording saved.", "success");
      } else {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = sanitizeFileName(payload.defaultPath, "cleanshot-recording.webm");
        anchor.rel = "noopener";
        anchor.style.display = "none";
        document.body.appendChild(anchor);
        anchor.click();
        document.body.removeChild(anchor);
        window.setTimeout(() => URL.revokeObjectURL(url), 5000);
        updateStatus("Recording ready for download.", "success");
      }
    } catch (error) {
      console.error("Failed to persist recording", error);
      updateStatus("Recording saved to memory only. Export failed.", "error");
    } finally {
      state.recordedChunks = [];
    }
  };

  const stopRecording = () => {
    if (!state.isRecording) {
      return;
    }
    state.isRecording = false;
    if (state.mediaRecorder && state.mediaRecorder.state !== "inactive") {
      try {
        state.mediaRecorder.stop();
      } catch (error) {
        console.warn("Failed to stop recorder cleanly", error);
      }
    }
    state.mediaRecorder = null;
    releaseStream();
    teardownPreview();
    updateButtons();
  };

  const handleRecorderStop = async () => {
    await finalizeRecording();
  };

  const ensureCanvasMetrics = () => {
    const padding = clamp(
      Number(state.visualConfig?.padding) || 0,
      0,
      480,
    );
    const metrics = computeCanvasDimensions(
      state.frameSize,
      padding,
      Boolean(state.visualConfig?.withShadow),
    );
    if (
      controls.canvas.width !== metrics.canvasWidth ||
      controls.canvas.height !== metrics.canvasHeight
    ) {
      controls.canvas.width = metrics.canvasWidth;
      controls.canvas.height = metrics.canvasHeight;
    }
    // Always recompute CSS display size to match container changes.
    updateCanvasDisplayScale(controls.canvas, metrics, controls.stage);
    state.metrics = metrics;
  };

  const renderFrame = (timestamp) => {
    if (!state.isPreviewActive || !controls.canvas) {
      return;
    }

    const ctx = controls.canvas.getContext("2d");
    const video = controls.video;
    if (!ctx || !video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      state.animationHandle = window.requestAnimationFrame(renderFrame);
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

    ensureCanvasMetrics();
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
    const srcRect = viewport.sourceRect;

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
    ctx.drawImage(
      video,
      srcRect.x,
      srcRect.y,
      srcRect.width,
      srcRect.height,
      metrics.drawX,
      metrics.drawY,
      metrics.baseWidth,
      metrics.baseHeight,
    );
    ctx.restore();
    ctx.restore();

    if (controls.indicator && currentPreferences.showIndicator) {
      if (state.pointerInsideFrame) {
        const snapshot = autoZoomEngine.getSnapshot();
        const displayRect = controls.canvas.getBoundingClientRect();
        const scaleX = metrics.canvasWidth > 0 ? displayRect.width / metrics.canvasWidth : 1;
        const scaleY = metrics.canvasHeight > 0 ? displayRect.height / metrics.canvasHeight : 1;
        const cursorX = metrics.drawX + snapshot.cursor.x * metrics.baseWidth;
        const cursorY = metrics.drawY + snapshot.cursor.y * metrics.baseHeight;
        const indicatorWidth = controls.indicator.offsetWidth || 24;
        const indicatorHeight = controls.indicator.offsetHeight || 24;
        const translateX =
          displayRect.left + cursorX * scaleX - indicatorWidth / 2;
        const translateY =
          displayRect.top + cursorY * scaleY - indicatorHeight / 2;
        controls.indicator.style.transform = `translate(${translateX}px, ${translateY}px)`;
      }
    }

    state.animationHandle = window.requestAnimationFrame(renderFrame);
  };

  const startPreview = async () => {
    if (!controls.video || !controls.canvas) {
      updateStatus("Recording preview unavailable.", "error");
      return false;
    }

    if (!state.mediaStream) {
      updateStatus("No stream available for preview.", "error");
      return false;
    }

    updatePointerPresence(false);

    controls.video.srcObject = state.mediaStream;
    try {
      await controls.video.play();
    } catch (error) {
      console.warn("Failed to start video preview", error);
    }

    // Read preview canvas size before hiding it, to match recording canvas initially.
    const prevRect =
      previewCanvas && !previewCanvas.classList.contains("is-hidden")
        ? previewCanvas.getBoundingClientRect()
        : null;

    // If the video has dimensions already, prime frame and metrics to avoid 1x1 flicker.
    const immediateFrame = getVideoFrameSize(controls.video);
    if (immediateFrame.width > 1 && immediateFrame.height > 1) {
      state.frameSize = immediateFrame;
      autoZoomEngine.setFrameSize(immediateFrame.width, immediateFrame.height);
      ensureCanvasMetrics();
    }

    // Match the previous preview display size to avoid any visual jump.
    if (prevRect && prevRect.width > 0 && prevRect.height > 0) {
      controls.canvas.style.width = `${Math.round(prevRect.width)}px`;
      controls.canvas.style.height = `${Math.round(prevRect.height)}px`;
    }

    if (previewCanvas && !previewCanvas.classList.contains("is-hidden")) {
      previewCanvas.classList.add("is-hidden");
      state.previewHiddenByRecording = true;
    }
    if (previewStage) {
      previewStage.dataset.recording = "true";
    }
    if (controls.stage) {
      controls.stage.classList.remove("is-hidden");
      controls.stage.setAttribute("aria-hidden", "false");
      // Prime CSS sizing immediately to avoid visual jump.
      updateCanvasDisplayScale(controls.canvas, state.metrics, controls.stage);
    }

    state.isPreviewActive = true;
    autoZoomEngine.setFrameSize(state.frameSize.width, state.frameSize.height);
    scheduleOverlaySync();

    if (state.animationHandle) {
      window.cancelAnimationFrame(state.animationHandle);
    }
    state.animationHandle = window.requestAnimationFrame(renderFrame);
    return true;
  };

  const startRecording = async () => {
    if (state.isRecording) {
      return;
    }
    if (!state.selectedSourceId) {
      updateStatus("Choose a capture source first.", "error");
      return;
    }

    stopRecording();
    releaseStream();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: state.selectedSourceId,
            maxFrameRate: 60,
          },
        },
      });
      state.mediaStream = stream;
    } catch (error) {
      console.error("Failed to acquire desktop stream", error);
      updateStatus("Unable to access that window or display.", "error");
      return;
    }

    const started = await startPreview();
    if (!started) {
      releaseStream();
      return;
    }

    const captureStream = controls.canvas.captureStream(60);
    const recorder = new MediaRecorder(captureStream, {
      mimeType: state.recordingMimeType,
    });

    recorder.ondataavailable = (event) => {
      if (event?.data && event.data.size > 0) {
        state.recordedChunks.push(event.data);
      }
    };
    recorder.onstop = handleRecorderStop;

    state.recordedChunks = [];
    state.mediaRecorder = recorder;
    state.isRecording = true;
    recorder.start(250);

    updateButtons();
    updateStatus("Recording started.", "success");
  };

  const handlePointerMove = (event) => {
    if (!state.isPreviewActive || !state.metrics) {
      updatePointerPresence(false);
      return;
    }
    const framePoint = mapPointerToFrame(
      event,
      controls.canvas,
      state.frameSize,
      state.metrics,
    );
    if (!framePoint) {
      updatePointerPresence(false);
      return;
    }
    updatePointerPresence(true);
    state.lastPointer = framePoint;
    autoZoomEngine.updateFollow(framePoint);
    autoZoomEngine.updateCursor(framePoint);
  };

  const handlePointerDown = (event) => {
    if (event.button !== 0 || !state.isPreviewActive) {
      return;
    }
    const framePoint = mapPointerToFrame(
      event,
      controls.canvas,
      state.frameSize,
      state.metrics,
    );
    if (!framePoint) {
      updatePointerPresence(false);
      return;
    }
    updatePointerPresence(true);
    state.lastPointer = framePoint;
    autoZoomEngine.handleClick(framePoint);
  };

  const handleOverlayPointer = (_event, payload) => {
    if (
      !payload ||
      !state.overlay.supported ||
      !state.isRecording
    ) {
      return;
    }
    if (!payload.inside || payload.x === null || payload.y === null) {
      updatePointerPresence(false);
      return;
    }
    updatePointerPresence(true);
    const framePoint = {
      x: clamp(Number(payload.x) || 0, 0, state.frameSize.width),
      y: clamp(Number(payload.y) || 0, 0, state.frameSize.height),
    };
    state.lastPointer = framePoint;
    if (payload.type === "move") {
      autoZoomEngine.updateFollow(framePoint);
      autoZoomEngine.updateCursor(framePoint);
      return;
    }
    if (payload.type === "down" && payload.button === 0) {
      autoZoomEngine.handleClick(framePoint);
    }
  };

  if (state.overlay.supported && typeof window.cleanShot?.on === "function") {
    state.overlayListenerCleanup =
      window.cleanShot.on("cursor-overlay:pointer", handleOverlayPointer);
  }

  const bindEvents = () => {
    controls.sourceSelect?.addEventListener("change", (event) => {
      const value = event.target.value || "";
      state.selectedSourceId = value || null;
      updateButtons();
    });

    controls.enableToggle?.addEventListener("change", () => {
      const prefs = readPreferencesFromControls();
      applyPreferences(prefs);
    });

    (controls.modeRadios || []).forEach((radio) => {
      radio.addEventListener("change", () => {
        const prefs = readPreferencesFromControls();
        applyPreferences(prefs);
      });
    });

    controls.zoomSlider?.addEventListener("input", (event) => {
      if (controls.zoomValueLabel) {
        controls.zoomValueLabel.textContent = `${Number(event.target.value).toFixed(1)}x`;
      }
      const prefs = readPreferencesFromControls();
      applyPreferences(prefs);
    });

    controls.durationInput?.addEventListener("input", () => {
      const prefs = readPreferencesFromControls();
      applyPreferences(prefs);
    });

    controls.holdInput?.addEventListener("input", () => {
      const prefs = readPreferencesFromControls();
      applyPreferences(prefs);
    });

    controls.easingSelect?.addEventListener("change", () => {
      const prefs = readPreferencesFromControls();
      applyPreferences(prefs);
    });

    controls.detectElementsToggle?.addEventListener("change", () => {
      const prefs = readPreferencesFromControls();
      applyPreferences(prefs);
    });

    controls.indicatorToggle?.addEventListener("change", () => {
      const prefs = readPreferencesFromControls();
      applyPreferences(prefs);
    });

    controls.followSlider?.addEventListener("input", (event) => {
      if (controls.followValueLabel) {
        controls.followValueLabel.textContent = `${Number(event.target.value).toFixed(2)}`;
      }
      const prefs = readPreferencesFromControls();
      applyPreferences(prefs);
    });

    controls.deadZoneInput?.addEventListener("input", () => {
      const prefs = readPreferencesFromControls();
      applyPreferences(prefs);
    });

    controls.startBtn?.addEventListener("click", () => {
      startRecording();
    });

    controls.stopBtn?.addEventListener("click", () => {
      stopRecording();
    });

    controls.stage?.addEventListener("pointermove", handlePointerMove);
    controls.stage?.addEventListener("pointerdown", handlePointerDown);
    controls.stage?.addEventListener("pointerleave", () => {
      updatePointerPresence(false);
    });
    controls.stage?.addEventListener("pointercancel", () => {
      updatePointerPresence(false);
    });

    // Keep display scaling in sync with window size changes.
    window.addEventListener("resize", () => {
      if (state.isPreviewActive) {
        updateCanvasDisplayScale(controls.canvas, state.metrics, controls.stage);
      }
    });
  };

  bindEvents();
  updateButtons();

  if (window.cleanShotVisualState?.subscribe) {
    window.cleanShotVisualState.subscribe((snapshot) => {
      state.visualConfig = snapshot || state.visualConfig;
      ensureCanvasMetrics();
    });
  }

  window.addEventListener("beforeunload", () => {
    if (typeof state.overlayListenerCleanup === "function") {
      state.overlayListenerCleanup();
      state.overlayListenerCleanup = null;
    }
    stopOverlaySession();
  });

  return {
    syncSources,
    setActiveSource,
    getState: () => ({
      isRecording: state.isRecording,
      selectedSourceId: state.selectedSourceId,
      mimeType: state.recordingMimeType,
    }),
  };
};
