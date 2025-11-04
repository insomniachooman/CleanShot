"use strict";

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const lerp = (start, end, factor) => start + (end - start) * factor;

const easeLinear = (t) => t;
const easeInOut = (t) => {
  if (t <= 0) {
    return 0;
  }
  if (t >= 1) {
    return 1;
  }
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeIn = (t) => t * t * t;

const easingMap = new Map([
  ["linear", easeLinear],
  ["ease-in", easeIn],
  ["ease-out", easeOut],
  ["ease-in-out", easeInOut],
]);

const DEFAULT_CENTER = { x: 0, y: 0 };

const resolveEase = (id) => {
  if (!id) {
    return easeInOut;
  }
  const key = id.toLowerCase();
  return easingMap.get(key) || easeInOut;
};

const buildSettings = (overrideSettings = {}) => {
  const defaults = {
    enableAutoZoom: true,
    zoomMode: "click_only",
    zoomLevel: 2,
    animationDuration: 400,
    easing: "ease-in-out",
    holdDuration: 800,
    followSensitivity: 0.7,
    deadZoneRadius: 100,
    detectUiElements: true,
    showIndicator: true,
  };
  return Object.assign({}, defaults, overrideSettings || {});
};

export const createCursorAutoZoomEngine = (options = {}) => {
  const settings = buildSettings(options.initialSettings);
  const easeFn = () => resolveEase(settings.easing || "ease-in-out");

  const state = {
    enabled: Boolean(settings.enableAutoZoom),
    zoomMode: settings.zoomMode,
    baseZoom: clamp(Number(settings.zoomLevel) || 2, 1, 3),
    animationDuration: clamp(
      Number(settings.animationDuration) || 400,
      200,
      1000,
    ),
    holdDuration: clamp(Number(settings.holdDuration) || 800, 0, 4000),
    followSensitivity: clamp(Number(settings.followSensitivity) || 0.7, 0.05, 1),
    deadZoneRadius: clamp(Number(settings.deadZoneRadius) || 100, 0, 600),
    detectUiElements: Boolean(settings.detectUiElements),
    showIndicator: Boolean(settings.showIndicator),
    currentZoom: 1,
    targetZoom: 1,
    zoomAnchor: { x: 0.5, y: 0.5 },
    cursorPosition: { x: 0.5, y: 0.5 },
    targetPosition: { x: 0.5, y: 0.5 },
    lastClickTs: 0,
    zoomPhase: "idle", // idle | zooming | holding | returning
    animationStartTs: 0,
    animationEase: easeInOut,
    frameSize: { width: 1, height: 1 },
    indicatorOpacity: 0,
  };

  let focusResolver = options.focusResolver || null;
  let indicatorEmitter = options.indicatorEmitter || null;

  const updateEase = () => {
    const fn = easeFn();
    state.animationEase = typeof fn === "function" ? fn : easeInOut;
  };

  updateEase();

  const applySettings = (nextSettings = {}) => {
    const merged = buildSettings(nextSettings);
    state.enabled = Boolean(merged.enableAutoZoom);
    state.zoomMode = merged.zoomMode;
    state.baseZoom = clamp(Number(merged.zoomLevel) || 2, 1, 3);
    state.animationDuration = clamp(
      Number(merged.animationDuration) || 400,
      200,
      1000,
    );
    state.holdDuration = clamp(Number(merged.holdDuration) || 800, 0, 4000);
    state.followSensitivity = clamp(
      Number(merged.followSensitivity) || 0.7,
      0.05,
      1,
    );
    state.deadZoneRadius = clamp(
      Number(merged.deadZoneRadius) || 100,
      0,
      600,
    );
    state.detectUiElements = Boolean(merged.detectUiElements);
    state.showIndicator = Boolean(merged.showIndicator);
    settings.easing = merged.easing;
    updateEase();
  };

  const setFrameSize = (width, height) => {
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      return;
    }
    state.frameSize.width = Math.max(1, Math.round(width));
    state.frameSize.height = Math.max(1, Math.round(height));
  };

  const normalizeToUnit = (point, fallback = DEFAULT_CENTER) => {
    const width = state.frameSize.width;
    const height = state.frameSize.height;

    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return {
        x: clamp(fallback.x, 0, 1),
        y: clamp(fallback.y, 0, 1),
      };
    }

    return {
      x: clamp(point.x / width, 0, 1),
      y: clamp(point.y / height, 0, 1),
    };
  };

  const setCursorPosition = (point) => {
    state.cursorPosition = normalizeToUnit(point, state.cursorPosition);
    state.targetPosition = state.cursorPosition;
  };

  const setTargetPosition = (point) => {
    state.targetPosition = normalizeToUnit(point, state.targetPosition);
  };

  const applyFollow = (point) => {
    const normalized = normalizeToUnit(point, state.targetPosition);
    const dx = normalized.x - state.cursorPosition.x;
    const dy = normalized.y - state.cursorPosition.y;
    const distPx = Math.sqrt(dx * dx + dy * dy) * state.frameSize.width;

    if (distPx <= state.deadZoneRadius) {
      return;
    }
    const factor = clamp(state.followSensitivity, 0.01, 1);
    state.targetPosition = normalizeToUnit(point, state.targetPosition);
    state.cursorPosition = {
      x: lerp(state.cursorPosition.x, state.targetPosition.x, factor),
      y: lerp(state.cursorPosition.y, state.targetPosition.y, factor),
    };
  };

  const setFocusResolver = (resolver) => {
    focusResolver = typeof resolver === "function" ? resolver : null;
  };

  const setIndicatorEmitter = (emitter) => {
    indicatorEmitter = typeof emitter === "function" ? emitter : null;
  };

  const resolveFocusZoom = async (point) => {
    if (!state.detectUiElements || !focusResolver) {
      return {
        zoom: state.baseZoom,
        anchor: normalizeToUnit(point, state.cursorPosition),
      };
    }
    try {
      const result = await focusResolver({
        point,
        frameSize: { ...state.frameSize },
        requestedZoom: state.baseZoom,
      });
      if (
        !result ||
        !Number.isFinite(result.zoom) ||
        !result.anchor ||
        !Number.isFinite(result.anchor.x) ||
        !Number.isFinite(result.anchor.y)
      ) {
        return {
          zoom: state.baseZoom,
          anchor: normalizeToUnit(point, state.cursorPosition),
        };
      }
      const zoomValue = clamp(result.zoom, 1, 3);
      const anchor = normalizeToUnit(result.anchor, state.cursorPosition);
      return { zoom: zoomValue, anchor };
    } catch (error) {
      console.warn("focusResolver failed", error);
      return {
        zoom: state.baseZoom,
        anchor: normalizeToUnit(point, state.cursorPosition),
      };
    }
  };

  const triggerIndicator = (intensity = 1) => {
    if (!state.showIndicator || !indicatorEmitter) {
      return;
    }
    const clamped = clamp(intensity, 0, 1);
    indicatorEmitter({
      active: true,
      intensity: clamped,
      timestamp: performance.now(),
    });
  };

  const handleClick = async (point, timestamp = performance.now()) => {
    if (!state.enabled) {
      return;
    }
    state.lastClickTs = timestamp;
    const { zoom, anchor } = await resolveFocusZoom(point);
    state.zoomAnchor = anchor;
    state.targetZoom = Math.max(1, zoom);
    state.zoomPhase = "zooming";
    state.animationStartTs = timestamp;
    triggerIndicator(clamp((zoom - 1) / 2, 0.05, 1));
    setTargetPosition(point);
  };

  const cancelZoom = () => {
    state.targetZoom = 1;
    state.zoomPhase = "returning";
    state.animationStartTs = performance.now();
  };

  const updateFollow = (point) => {
    if (!state.enabled) {
      return;
    }
    if (state.zoomMode === "click_only") {
      return;
    }
    applyFollow(point);
  };

  const updateCursor = (point) => {
    state.cursorPosition = normalizeToUnit(point, state.cursorPosition);
  };

  const update = (timestamp = performance.now()) => {
    if (!state.enabled) {
      state.currentZoom = 1;
      state.targetZoom = 1;
      state.zoomPhase = "idle";
      return;
    }

    const dt = Math.max(timestamp - state.animationStartTs, 0);
    const duration = Math.max(state.animationDuration, 16);
    const progress = clamp(dt / duration, 0, 1);
    const eased = state.animationEase(progress);

    // Smooth cursor position towards target.
    state.cursorPosition = {
      x: lerp(state.cursorPosition.x, state.targetPosition.x, 0.25),
      y: lerp(state.cursorPosition.y, state.targetPosition.y, 0.25),
    };

    if (state.zoomPhase === "zooming") {
      state.currentZoom = lerp(1, state.targetZoom, eased);
      if (progress >= 1) {
        state.zoomPhase = "holding";
        state.animationStartTs = timestamp;
      }
    } else if (state.zoomPhase === "holding") {
      state.currentZoom = state.targetZoom;
      if (timestamp - state.lastClickTs >= state.holdDuration) {
        state.zoomPhase = "returning";
        state.animationStartTs = timestamp;
      }
    } else if (state.zoomPhase === "returning") {
      state.currentZoom = lerp(state.targetZoom, 1, eased);
      if (progress >= 1) {
        state.zoomPhase = "idle";
        state.targetZoom = 1;
        state.currentZoom = 1;
      }
    } else {
      state.currentZoom = lerp(state.currentZoom, 1, 0.08);
    }

    if (!state.showIndicator || !indicatorEmitter) {
      return;
    }
    const indicatorTarget =
      state.zoomPhase === "idle" ? 0 : clamp((state.currentZoom - 1) / 2, 0, 1);
    state.indicatorOpacity = lerp(
      state.indicatorOpacity,
      indicatorTarget,
      indicatorTarget > state.indicatorOpacity ? 0.4 : 0.15,
    );
    indicatorEmitter({
      active: state.indicatorOpacity > 0.01,
      opacity: state.indicatorOpacity,
      timestamp,
    });
  };

  const getViewport = () => {
    const zoom = Math.max(state.currentZoom, 1);
    const width = state.frameSize.width;
    const height = state.frameSize.height;
    const visibleWidth = width / zoom;
    const visibleHeight = height / zoom;
    const centerX = clamp(
      state.cursorPosition.x * width,
      visibleWidth / 2,
      width - visibleWidth / 2,
    );
    const centerY = clamp(
      state.cursorPosition.y * height,
      visibleHeight / 2,
      height - visibleHeight / 2,
    );

    const left = clamp(centerX - visibleWidth / 2, 0, width - visibleWidth);
    const top = clamp(centerY - visibleHeight / 2, 0, height - visibleHeight);

    return {
      zoom,
      sourceRect: {
        x: left,
        y: top,
        width: visibleWidth,
        height: visibleHeight,
      },
      anchor: { ...state.zoomAnchor },
    };
  };

  const getSnapshot = () => ({
    enabled: state.enabled,
    zoomMode: state.zoomMode,
    zoom: state.currentZoom,
    targetZoom: state.targetZoom,
    phase: state.zoomPhase,
    cursor: { ...state.cursorPosition },
    anchor: { ...state.zoomAnchor },
  });

  return {
    applySettings,
    setFrameSize,
    setFocusResolver,
    setIndicatorEmitter,
    handleClick,
    cancelZoom,
    updateFollow,
    updateCursor,
    updateTarget: setTargetPosition,
    update,
    getViewport,
    getSnapshot,
  };
};

export { buildSettings };
