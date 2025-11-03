"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const sanitizePayload = (payload = {}) => ({
  sessionId: payload.sessionId,
  displayId: payload.displayId,
  rect: payload.rect || null,
  fullscreen: Boolean(payload.fullscreen),
});

contextBridge.exposeInMainWorld("snipping", {
  onInit(listener) {
    if (typeof listener !== "function") {
      return;
    }

    ipcRenderer.once("snipping:init", (_event, payload) => {
      listener(payload);
    });
  },
  complete(payload) {
    const { sessionId, displayId, rect, fullscreen } = sanitizePayload(payload);
    if (!sessionId || !displayId) {
      return;
    }

    ipcRenderer.send("snipping:complete", {
      sessionId,
      displayId,
      rect,
      fullscreen,
    });
  },
  cancel(payload) {
    const sessionId =
      typeof payload === "string" ? payload : payload?.sessionId;
    if (!sessionId) {
      return;
    }

    ipcRenderer.send("snipping:cancel", { sessionId });
  },
});
