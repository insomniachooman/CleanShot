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
  saveImage(payload) {
    return safeInvoke("file:save-image", payload);
  },
  openImage() {
    return safeInvoke("file:open-image");
  },
  on(event, listener) {
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
  once(event, listener) {
    ipcRenderer.once(event, listener);
  },
});
