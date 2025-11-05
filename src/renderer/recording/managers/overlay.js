
"use strict";

export const buildOverlayPayload = (state) => {
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

export const performOverlaySync = async (state) => {
  if (!state.overlay.supported) {
    return;
  }

  const payload = buildOverlayPayload(state);
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

export const scheduleOverlaySync = (state) => {
  if (!state.overlay.supported) {
    return;
  }
  if (state.overlay.busy) {
    state.overlay.needsResync = true;
    return;
  }
  state.overlay.busy = true;
  performOverlaySync(state)
    .catch((error) => {
      console.warn("Cursor overlay synchronization failed", error);
    })
    .finally(() => {
      state.overlay.busy = false;
      if (state.overlay.needsResync) {
        state.overlay.needsResync = false;
        scheduleOverlaySync(state);
      }
    });
};

export const stopOverlaySession = async (state, updatePointerPresence) => {
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
