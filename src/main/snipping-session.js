"use strict";

const path = require("path");
const {
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  screen,
} = require("electron");

let activeSession = null;
let ipcListenersRegistered = false;

const resolveOverlayFile = () =>
  path.join(__dirname, "../snipping/index.html");

const resolveOverlayPreload = () =>
  path.join(__dirname, "../preload/snipping-preload.js");

const pointInBounds = (point, bounds) => {
  return (
    point.x >= bounds.x &&
    point.x <= bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y <= bounds.y + bounds.height
  );
};

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const computeCaptureSizeForDisplay = (display) => {
  const scaleFactor = display.scaleFactor || 1;
  return {
    width: Math.max(
      1,
      Math.round((display.size?.width || display.bounds.width) * scaleFactor),
    ),
    height: Math.max(
      1,
      Math.round((display.size?.height || display.bounds.height) * scaleFactor),
    ),
  };
};

const toDataUrl = (image) => {
  const buffer = image.toPNG();
  const base64 = buffer.toString("base64");
  return `data:image/png;base64,${base64}`;
};

const closeOverlayWindows = (entries) => {
  for (const entry of entries) {
    const overlay = entry.window;
    if (overlay && !overlay.isDestroyed()) {
      overlay.close();
    }
  }
};

const hideOverlayWindows = (entries) => {
  for (const entry of entries) {
    const overlay = entry.window;
    if (overlay && !overlay.isDestroyed()) {
      overlay.hide();
    }
  }
};

const ensureIpcListeners = () => {
  if (ipcListenersRegistered) {
    return;
  }

  ipcMain.on("snipping:complete", async (_event, payload) => {
    if (!activeSession || !payload) {
      return;
    }

    const { id: sessionId } = activeSession;
    if (payload.sessionId !== sessionId) {
      return;
    }

    await finalizeSession(async (session) => {
      return {
        canceled: false,
        capture: await createCaptureFromPayload(session, payload),
      };
    });
  });

  ipcMain.on("snipping:cancel", async (_event, payload) => {
    if (!activeSession) {
      return;
    }

    const { id: sessionId } = activeSession;
    if (payload?.sessionId && payload.sessionId !== sessionId) {
      return;
    }

    await finalizeSession(async () => ({ canceled: true }));
  });

  ipcListenersRegistered = true;
};

const finalizeSession = async (resultFactory) => {
  if (!activeSession) {
    return;
  }

  const session = activeSession;
  activeSession = null;

  hideOverlayWindows(session.overlays);

  let result;
  let error;
  try {
    result = await resultFactory(session);
  } catch (factoryError) {
    error = factoryError;
  }

  closeOverlayWindows(session.overlays);

  try {
    if (typeof session.restoreOwner === "function") {
      session.restoreOwner();
    }
  } catch (_restoreError) {
    // Non-fatal; ignore restore errors.
  }

  if (error) {
    session.reject(error);
    return;
  }

  session.resolve(result);
};

const captureDisplayImage = async (display) => {
  const normalizedDisplayId = String(display.id);

  const resolveSourceForDisplay = (sources) => {
    let matchingSource = sources.find(
      (source) => source.display_id === normalizedDisplayId,
    );

    if (!matchingSource) {
      matchingSource = sources.find((source) => {
        const parts = typeof source.id === "string" ? source.id.split(":") : [];
        return parts[parts.length - 1] === normalizedDisplayId;
      });
    }

    if (!matchingSource && sources.length === 1) {
      return sources[0];
    }

    return matchingSource;
  };

  const attemptCapture = async (thumbnailSize) => {
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize,
    });

    const matchingSource = resolveSourceForDisplay(sources);
    if (
      matchingSource &&
      matchingSource.thumbnail &&
      !matchingSource.thumbnail.isEmpty()
    ) {
      return matchingSource.thumbnail;
    }

    return null;
  };

  const requestedSize = computeCaptureSizeForDisplay(display);
  const thumbnail =
    (await attemptCapture(requestedSize)) ||
    (await attemptCapture({ width: 0, height: 0 }));

  if (!thumbnail) {
    throw new Error("Unable to capture desktop content for that display.");
  }

  return thumbnail;
};

const normalizeRect = (rect, display) => {
  if (!rect) {
    return null;
  }

  const widthLimit = display.bounds.width;
  const heightLimit = display.bounds.height;

  const x = clamp(rect.x ?? 0, 0, widthLimit);
  const y = clamp(rect.y ?? 0, 0, heightLimit);
  const widthRange = Math.max(1, widthLimit - x);
  const heightRange = Math.max(1, heightLimit - y);
  const width = clamp(rect.width ?? widthLimit, 1, widthRange);
  const height = clamp(rect.height ?? heightLimit, 1, heightRange);

  return { x, y, width, height };
};

const createCaptureFromPayload = async (session, payload) => {
  const { displayId, rect, fullscreen } = payload;

  const entry = session.overlays.find(
    (item) => String(item.display.id) === String(displayId),
  );

  if (!entry) {
    throw new Error("Could not resolve display for the captured area.");
  }

  const { display } = entry;
  const displayImage = await captureDisplayImage(display);
  const imageSize = displayImage.getSize();

  const scaleFactor = display.scaleFactor || 1;
  let cropRect;

  if (fullscreen) {
    cropRect = {
      x: 0,
      y: 0,
      width: imageSize.width,
      height: imageSize.height,
    };
  } else {
    const normalized = normalizeRect(rect, display);
    const scaleX =
      display.bounds.width > 0
        ? imageSize.width / display.bounds.width
        : 1;
    const scaleY =
      display.bounds.height > 0
        ? imageSize.height / display.bounds.height
        : 1;
 
    // Compute scaled edges, then use floor/ceil to avoid cutting edges.
    const left = normalized.x * scaleX;
    const top = normalized.y * scaleY;
    const right = (normalized.x + normalized.width) * scaleX;
    const bottom = (normalized.y + normalized.height) * scaleY;
  
    const x = clamp(Math.floor(left), 0, imageSize.width);
    const y = clamp(Math.floor(top), 0, imageSize.height);
    const r = clamp(Math.ceil(right), 0, imageSize.width);
    const b = clamp(Math.ceil(bottom), 0, imageSize.height);
  
    const width = clamp(r - x, 1, imageSize.width - x);
    const height = clamp(b - y, 1, imageSize.height - y);
  
    cropRect = { x, y, width, height };
  }

  const finalImage =
    cropRect.x === 0 &&
    cropRect.y === 0 &&
    cropRect.width === imageSize.width &&
    cropRect.height === imageSize.height
      ? displayImage
      : displayImage.crop(cropRect);

  if (!finalImage || finalImage.isEmpty?.()) {
    throw new Error("The captured selection was empty.");
  }

  const size = finalImage.getSize();
  const dataURL = toDataUrl(finalImage);

  const timestamp = new Date();
  const isoTime = timestamp.toISOString().replace(/[:.]/g, "-");
  const modeLabel = fullscreen ? "Display" : "Selection";

  return {
    id: `snip:${timestamp.getTime()}`,
    name: `${modeLabel} ${isoTime}`,
    type: fullscreen ? "screen" : "snip",
    displayId: String(display.id),
    width: size.width,
    height: size.height,
    dataURL,
    origin: "area",
  };
};

const createOverlayWindow = (display, sessionId) => {
  const overlay = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: true,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    title: "CleanShot Capture Overlay",
    webPreferences: {
      preload: resolveOverlayPreload(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: false,
    },
  });

  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.loadFile(resolveOverlayFile()).catch((error) => {
    console.warn("Failed to load snipping overlay", error);
  });

  overlay.once("ready-to-show", () => {
    overlay.showInactive();
  });

  overlay.webContents.once("did-finish-load", () => {
    overlay.webContents.send("snipping:init", {
      sessionId,
      display: {
        id: String(display.id),
        bounds: display.bounds,
        scaleFactor: display.scaleFactor || 1,
      },
    });
  });

  return overlay;
};

const beginSnippingSession = async (options = {}) => {
  if (activeSession) {
    throw new Error("A snipping session is already running.");
  }

  const displays = screen.getAllDisplays();
  if (!displays || displays.length === 0) {
    throw new Error("No displays are available for capture.");
  }

  ensureIpcListeners();

  return new Promise((resolve, reject) => {
    const sessionId = [
      "snip",
      Date.now().toString(16),
      Math.random().toString(16).slice(2, 8),
    ].join("-");

    const overlays = [];
    let ownerWindowHidden = false;

    const restoreOwner = () => {
      const ownerWindow = options.ownerWindow;
      if (!ownerWindow || ownerWindow.isDestroyed?.()) {
        return;
      }

      if (!ownerWindowHidden) {
        ownerWindow.focus();
        return;
      }

      if (ownerWindow.isMinimized?.()) {
        ownerWindow.restore();
      }

      ownerWindow.show();
      ownerWindow.focus();
    };

    activeSession = {
      id: sessionId,
      overlays,
      resolve,
      reject,
      restoreOwner,
    };

    try {
      const ownerWindow = options.ownerWindow;
      if (ownerWindow && ownerWindow.isVisible?.()) {
        ownerWindowHidden = true;
        ownerWindow.hide();
      }

      const cursorPoint = screen.getCursorScreenPoint();

      for (const display of displays) {
        const windowRef = createOverlayWindow(display, sessionId);
        overlays.push({ display, window: windowRef });
      }

      const focusedEntry =
        overlays.find((entry) =>
          pointInBounds(cursorPoint, entry.display.bounds),
        ) || overlays[0];

      if (focusedEntry && focusedEntry.window && !focusedEntry.window.isDestroyed()) {
        focusedEntry.window.focus();
      }
    } catch (error) {
      closeOverlayWindows(overlays);
      activeSession = null;
      reject(error);
    }
  });
};

module.exports = {
  beginSnippingSession,
};
