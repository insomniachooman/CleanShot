
"use strict";

import { EASE_OPTIONS, ASPECT_RATIOS } from "../constants.js";

export const buildControls = () => ({
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
  aspectRatioSelect: document.getElementById("aspectRatioSelect"),
  startBtn: document.getElementById("startRecordingBtn"),
  stopBtn: document.getElementById("stopRecordingBtn"),
  statusDisplay: document.getElementById("recordingStatus"),
});

export const renderEasingOptions = (selectEl) => {
  if (!selectEl) {
    return;
  }
  if (selectEl.options.length === EASE_OPTIONS.length) {
    return;
  }
  selectEl.innerHTML = "";
  EASE_OPTIONS.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    selectEl.appendChild(opt);
  });
};

export const renderAspectRatioOptions = (selectEl) => {
  if (!selectEl) {
    return;
  }
  if (selectEl.options.length === ASPECT_RATIOS.length) {
    return;
  }
  selectEl.innerHTML = "";
  ASPECT_RATIOS.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    selectEl.appendChild(opt);
  });
};

export const updateButtons = (state, controls) => {
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

export const updateStatus = (controls, publishStatus, message, tone = "neutral") => {
  if (controls.statusDisplay) {
    controls.statusDisplay.textContent = message || "";
    controls.statusDisplay.dataset.tone = tone;
  }
  publishStatus(message, tone);
};

export const syncSources = (state, controls) => {
  state.sources = Array.isArray(state.sources) ? state.sources : [];
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
};
