"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const safeInvoke = (channel, ...args) => {
  return ipcRenderer.invoke(channel, ...args);
};

contextBridge.exposeInMainWorld("cleanShot", {
  listSources() {
    return safeInvoke("sources:list");
  },
  captureSource(sourceId) {
    return safeInvoke("sources:capture", sourceId);
  },
  captureDesktopWallpaper(payload) {
    return safeInvoke("desktop:wallpaper", payload);
  },
  listDefaultDesktopWallpapers() {
    return safeInvoke("desktop:list-default-wallpapers");
  },
  listCustomBackgrounds() {
    return safeInvoke("backgrounds:list-custom");
  },
  saveCustomBackground(payload) {
    return safeInvoke("backgrounds:save-custom", payload);
  },
  captureArea() {
    return safeInvoke("snipping:capture-area");
  },
  startCursorOverlay(payload) {
    return safeInvoke("cursor-overlay:start", payload);
  },
  updateCursorOverlay(payload) {
    return safeInvoke("cursor-overlay:update", payload);
  },
  stopCursorOverlay() {
    return safeInvoke("cursor-overlay:stop");
  },
  saveImage(payload) {
    return safeInvoke("file:save-image", payload);
  },
  saveVideo(payload) {
    return safeInvoke("file:save-video", payload);
  },
  openImage() {
    return safeInvoke("file:open-image");
  },
  // NEW: bridge for copying images to the system clipboard
  copyImageToClipboard(payload) {
    return safeInvoke("clipboard:write-image", payload);
  },
  on(event, listener) {
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
  once(event, listener) {
    ipcRenderer.once(event, listener);
  },
});
