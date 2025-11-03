const selectionEl = document.querySelector('[data-role="selection"]');
const sizeLabelEl = document.querySelector('[data-role="size"]');
const hintEl = document.querySelector('[data-role="hint"]');

const state = {
  sessionId: null,
  displayId: null,
  pointerId: null,
  isDrawing: false,
  start: null,
  currentRect: null,
};

const hideHint = () => {
  if (!hintEl) {
    return;
  }
  hintEl.dataset.hidden = "true";
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const normalizeRect = (startPoint, currentPoint) => {
  const left = Math.min(startPoint.x, currentPoint.x);
  const top = Math.min(startPoint.y, currentPoint.y);
  const right = Math.max(startPoint.x, currentPoint.x);
  const bottom = Math.max(startPoint.y, currentPoint.y);

  const maxWidth = window.innerWidth;
  const maxHeight = window.innerHeight;

  const x = clamp(left, 0, maxWidth);
  const y = clamp(top, 0, maxHeight);
  const width = clamp(right - left, 0, maxWidth - x);
  const height = clamp(bottom - top, 0, maxHeight - y);

  return { x, y, width, height };
};

const renderSelection = (rect) => {
  if (!selectionEl) {
    return;
  }

  if (!rect) {
    selectionEl.hidden = true;
    return;
  }

  selectionEl.hidden = false;
  selectionEl.style.left = `${rect.x}px`;
  selectionEl.style.top = `${rect.y}px`;
  selectionEl.style.width = `${rect.width}px`;
  selectionEl.style.height = `${rect.height}px`;

  if (sizeLabelEl) {
    sizeLabelEl.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
  }
};

const clearSelection = () => {
  state.currentRect = null;
  renderSelection(null);
};

const sendComplete = (fullscreen = false) => {
  if (!window.snipping || !state.sessionId || !state.displayId) {
    return;
  }

  const payload = {
    sessionId: state.sessionId,
    displayId: state.displayId,
    fullscreen,
  };

  if (!fullscreen && state.currentRect) {
    payload.rect = {
      x: state.currentRect.x,
      y: state.currentRect.y,
      width: state.currentRect.width,
      height: state.currentRect.height,
    };
  }

  window.snipping.complete(payload);
};

const sendCancel = () => {
  if (!window.snipping || !state.sessionId) {
    return;
  }
  window.snipping.cancel({ sessionId: state.sessionId });
};

const handlePointerDown = (event) => {
  if (!state.sessionId || event.button !== 0) {
    if (event.button === 2) {
      sendCancel();
    }
    return;
  }

  hideHint();
  state.isDrawing = true;
  state.pointerId = event.pointerId;
  state.start = { x: event.clientX, y: event.clientY };

  if (event.target?.setPointerCapture) {
    try {
      event.target.setPointerCapture(event.pointerId);
    } catch (_captureError) {
      // Ignore pointer capture failures (not critical).
    }
  }

  state.currentRect = {
    x: state.start.x,
    y: state.start.y,
    width: 0,
    height: 0,
  };
  renderSelection(state.currentRect);
};

const handlePointerMove = (event) => {
  if (!state.isDrawing || event.pointerId !== state.pointerId) {
    return;
  }

  const nextRect = normalizeRect(state.start, {
    x: event.clientX,
    y: event.clientY,
  });

  state.currentRect = nextRect;
  renderSelection(nextRect);
};

const handlePointerUp = (event) => {
  if (!state.isDrawing || event.pointerId !== state.pointerId) {
    return;
  }

  state.isDrawing = false;
  state.pointerId = null;

  if (event.target?.releasePointerCapture) {
    try {
      event.target.releasePointerCapture(event.pointerId);
    } catch (_releaseError) {
      // Ignore release failures.
    }
  }

  const rect = state.currentRect;
  if (!rect || rect.width < 4 || rect.height < 4) {
    clearSelection();
    return;
  }

  renderSelection(rect);
  hideHint();
  sendComplete(false);
  clearSelection();
};

const handleKeyDown = (event) => {
  if (!state.sessionId) {
    return;
  }

  if (event.key === "Escape") {
    sendCancel();
  } else if (event.key === "Enter") {
    hideHint();
    sendComplete(true);
  }
};

const handleContextMenu = (event) => {
  event.preventDefault();
};

window.addEventListener("pointerdown", handlePointerDown, { capture: true });
window.addEventListener("pointermove", handlePointerMove, { capture: true });
window.addEventListener("pointerup", handlePointerUp, { capture: true });
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("contextmenu", handleContextMenu);

window.snipping?.onInit((payload) => {
  state.sessionId = payload?.sessionId || null;
  state.displayId = payload?.display?.id || null;

  if (!state.sessionId || !state.displayId) {
    // Without identifiers we cannot complete the capture; cancel proactively.
    sendCancel();
  }
});
