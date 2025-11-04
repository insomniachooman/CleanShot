"use strict";

const { ipcRenderer } = require("electron");

const emitPointerEvent = (type, event) => {
  if (!event || !event.isPrimary) {
    return;
  }
  ipcRenderer.send("cursor-overlay:pointer-event", {
    type,
    x: event.screenX,
    y: event.screenY,
    button: event.button,
    buttons: event.buttons,
  });
};

window.addEventListener(
  "pointermove",
  (event) => {
    emitPointerEvent("move", event);
  },
  { passive: true },
);

window.addEventListener(
  "pointerdown",
  (event) => {
    emitPointerEvent("down", event);
  },
  { passive: true },
);

window.addEventListener(
  "pointerup",
  (event) => {
    emitPointerEvent("up", event);
  },
  { passive: true },
);

window.addEventListener(
  "pointercancel",
  (event) => {
    emitPointerEvent("cancel", event);
  },
  { passive: true },
);

window.addEventListener(
  "contextmenu",
  (event) => {
    event.preventDefault();
  },
);

