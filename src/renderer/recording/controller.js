"use strict";

import { createCursorAutoZoomEngine, buildSettings } from "./auto-zoom-engine.js";
import { createFocusDetector } from "./focus-detector.js";
import { clamp, getVideoFrameSize } from "./utils/general.js";
import { mapPointerToFrame, updateCanvasDisplayScale } from "./utils/canvas.js";
import { buildControls, renderEasingOptions, renderAspectRatioOptions, updateButtons as updateButtonsUI, updateStatus as updateStatusUI, syncSources as syncSourcesUI } from "./ui/controls.js";
import {
  readPreferences,
  writePreferences,
  readPreferencesFromControls,
  applyPreferencesToControls
} from "./managers/preferences.js";
import { createState, getInitialVisualConfig } from "./managers/state.js";
import { scheduleOverlaySync, stopOverlaySession } from "./managers/overlay.js";
import { releaseStream, finalizeRecording, createRecorder } from "./managers/media-recorder.js";
import { renderFrame, ensureCanvasMetrics } from "./rendering/frame-renderer.js";

export const initializeRecordingController = (options = {}) => {
  const api = options.api || window.cleanShot;
  const controls = buildControls();
  const previewCanvas = options.previewCanvas || null;
  const previewStage = options.previewStage || null;
  const publishStatus =
    typeof options.onStatus === "function"
      ? options.onStatus
      : () => { };

  if (!controls.canvas || !controls.video) {
    console.warn("Recording controls unavailable; skipping auto-zoom initialization.");
    return null;
  }

  renderEasingOptions(controls.easingSelect);
  renderAspectRatioOptions(controls.aspectRatioSelect);

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

  const initialVisualConfig = getInitialVisualConfig();
  const state = createState(initialVisualConfig);

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

  const doScheduleOverlaySync = () => {
    scheduleOverlaySync(state);
  };

  const doStopOverlaySession = async () => {
    await stopOverlaySession(state, updatePointerPresence);
  };

  const applyPreferences = (nextPrefs, options = {}) => {
    applyPreferencesToControls(nextPrefs, controls);
    if (!options.skipWrite) {
      writePreferences(nextPrefs);
    }
    autoZoomEngine.applySettings(nextPrefs);
    currentPreferences = nextPrefs;
    state.aspectRatio = nextPrefs.aspectRatio || "original";
    ensureCanvasMetrics(state, controls);
    doScheduleOverlaySync();
    if (!nextPrefs.showIndicator && controls.indicator) {
      controls.indicator.style.opacity = "0";
    }
  };

  applyPreferencesToControls(preferences, controls);
  autoZoomEngine.applySettings(preferences);

  const updateButtons = () => {
    updateButtonsUI(state, controls);
  };

  const updateStatus = (message, tone = "neutral") => {
    updateStatusUI(controls, publishStatus, message, tone);
  };

  const syncSources = (sources) => {
    state.sources = Array.isArray(sources) ? sources : [];
    syncSourcesUI(state, controls);
    updateButtons();
    doScheduleOverlaySync();
  };

  const setActiveSource = (sourceId) => {
    state.selectedSourceId = sourceId || null;
    if (controls.sourceSelect && sourceId) {
      controls.sourceSelect.value = sourceId;
    }
    updateButtons();
    doScheduleOverlaySync();
  };

  const doReleaseStream = () => {
    releaseStream(state);
  };

  const teardownPreview = () => {
    if (state.animationHandle) {
      window.cancelAnimationFrame(state.animationHandle);
      state.animationHandle = null;
    }
    state.isPreviewActive = false;
    updatePointerPresence(false);
    doStopOverlaySession();
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

  const doFinalizeRecording = async () => {
    await finalizeRecording(state, api, updateStatus);
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
    doReleaseStream();
    teardownPreview();
    updateButtons();
  };

  const handleRecorderStop = async () => {
    await doFinalizeRecording();
  };

  const doRenderFrame = (timestamp) => {
    renderFrame(
      timestamp,
      state,
      controls,
      autoZoomEngine,
      doScheduleOverlaySync,
      currentPreferences
    );
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
      ensureCanvasMetrics(state, controls);
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
    doScheduleOverlaySync();

    if (state.animationHandle) {
      window.cancelAnimationFrame(state.animationHandle);
    }
    state.animationHandle = window.requestAnimationFrame(doRenderFrame);
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
    doReleaseStream();

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
      doReleaseStream();
      return;
    }

    const captureStream = controls.canvas.captureStream(60);
    const recorder = createRecorder(
      captureStream,
      state.recordingMimeType,
      (chunk) => state.recordedChunks.push(chunk),
      handleRecorderStop
    );

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

    const metrics = state.metrics;
    const cropMinX = metrics?.sourceOffsetX || 0;
    const cropMinY = metrics?.sourceOffsetY || 0;
    const cropWidth =
      metrics?.sourceWidth && metrics.sourceWidth > 0
        ? metrics.sourceWidth
        : state.frameSize.width;
    const cropHeight =
      metrics?.sourceHeight && metrics.sourceHeight > 0
        ? metrics.sourceHeight
        : state.frameSize.height;
    const cropMaxX = cropMinX + cropWidth;
    const cropMaxY = cropMinY + cropHeight;
    const rawX = Number(payload.x) || 0;
    const rawY = Number(payload.y) || 0;

    if (
      rawX < cropMinX ||
      rawX > cropMaxX ||
      rawY < cropMinY ||
      rawY > cropMaxY
    ) {
      updatePointerPresence(false);
      return;
    }

    updatePointerPresence(true);
    const framePoint = {
      x: clamp(rawX, cropMinX, Math.max(cropMinX, cropMaxX)),
      y: clamp(rawY, cropMinY, Math.max(cropMinY, cropMaxY)),
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
      const prefs = readPreferencesFromControls(controls);
      applyPreferences(prefs);
    });

    (controls.modeRadios || []).forEach((radio) => {
      radio.addEventListener("change", () => {
        const prefs = readPreferencesFromControls(controls);
        applyPreferences(prefs);
      });
    });

    controls.zoomSlider?.addEventListener("input", (event) => {
      if (controls.zoomValueLabel) {
        controls.zoomValueLabel.textContent = `${Number(event.target.value).toFixed(1)}x`;
      }
      const prefs = readPreferencesFromControls(controls);
      applyPreferences(prefs);
    });

    controls.durationInput?.addEventListener("input", () => {
      const prefs = readPreferencesFromControls(controls);
      applyPreferences(prefs);
    });

    controls.holdInput?.addEventListener("input", () => {
      const prefs = readPreferencesFromControls(controls);
      applyPreferences(prefs);
    });

    controls.easingSelect?.addEventListener("change", () => {
      const prefs = readPreferencesFromControls(controls);
      applyPreferences(prefs);
    });

    controls.detectElementsToggle?.addEventListener("change", () => {
      const prefs = readPreferencesFromControls(controls);
      applyPreferences(prefs);
    });

    controls.indicatorToggle?.addEventListener("change", () => {
      const prefs = readPreferencesFromControls(controls);
      applyPreferences(prefs);
    });

    controls.followSlider?.addEventListener("input", (event) => {
      if (controls.followValueLabel) {
        controls.followValueLabel.textContent = `${Number(event.target.value).toFixed(2)}`;
      }
      const prefs = readPreferencesFromControls(controls);
      applyPreferences(prefs);
    });

    controls.deadZoneInput?.addEventListener("input", () => {
      const prefs = readPreferencesFromControls(controls);
      applyPreferences(prefs);
    });

    controls.aspectRatioSelect?.addEventListener("change", () => {
      const prefs = readPreferencesFromControls(controls);
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
      ensureCanvasMetrics(state, controls);
    });
  }

  window.addEventListener("beforeunload", () => {
    if (typeof state.overlayListenerCleanup === "function") {
      state.overlayListenerCleanup();
      state.overlayListenerCleanup = null;
    }
    doStopOverlaySession();
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
