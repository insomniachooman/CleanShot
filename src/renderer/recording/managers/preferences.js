
"use strict";

import { buildSettings } from "../auto-zoom-engine.js";
import { PREFERENCES_KEY } from "../constants.js";
import { clamp } from "../utils/general.js";

export const readPreferences = () => {
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

export const writePreferences = (preferences) => {
  try {
    window.localStorage?.setItem(
      PREFERENCES_KEY,
      JSON.stringify(preferences ?? {}),
    );
  } catch (error) {
    console.warn("Failed to persist cursor zoom preferences", error);
  }
};

export const readPreferencesFromControls = (controls) => {
  const resolveModeFromControls = (modeRadios) => {
    const active = modeRadios.find((input) => input?.checked);
    return active ? active.value : "click_only";
  };

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
    aspectRatio: controls.aspectRatioSelect?.value || "original",
  };
  return buildSettings(nextPrefs);
};

export const applyPreferencesToControls = (prefs, controls) => {
  const setSwitchActive = (inputEl, active) => {
    if (!inputEl) {
      return;
    }
    const wrapper = inputEl.closest(".switch");
    if (wrapper) {
      wrapper.classList.toggle("is-active", Boolean(active));
    }
  };

  const syncModeRadios = (modeRadios, nextValue) => {
    modeRadios.forEach((input) => {
      input.checked = input.value === nextValue;
    });
  };

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
  if (controls.aspectRatioSelect) {
    controls.aspectRatioSelect.value = prefs.aspectRatio || "original";
  }
};
