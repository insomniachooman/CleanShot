"use strict";

const path = require("path");
const fs = require("fs").promises;
const electron = require("electron");
const {
  BrowserWindow,
  ipcMain,
  dialog,
  desktopCapturer,
  screen,
  nativeImage,
} = electron;

let mainWindow = undefined;

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";

const resolveRendererFile = (filename) =>
  path.join(__dirname, "../renderer", filename);

const computeThumbnailSize = () => {
  const display = screen.getPrimaryDisplay();
  const scaleFactor = display.scaleFactor || 1;
  const maxDimension = 3200;
  const width = Math.min(
    Math.floor(display.size.width * scaleFactor),
    maxDimension,
  );
  const height = Math.min(
    Math.floor(display.size.height * scaleFactor),
    maxDimension,
  );

  return { width, height };
};

const loadNativeImageFromFile = async (filePath) => {
  if (!filePath) {
    return null;
  }

  try {
    const buffer = await fs.readFile(filePath);
    if (!buffer?.length) {
      return null;
    }

    const image = nativeImage.createFromBuffer(buffer);
    return image.isEmpty() ? null : image;
  } catch (_error) {
    return null;
  }
};

const resolveWindowsWallpaperFile = async () => {
  if (!isWindows) {
    return null;
  }

  const appData = process.env.APPDATA;
  if (!appData) {
    return null;
  }

  const themesDir = path.join(appData, "Microsoft", "Windows", "Themes");
  const transcodedPath = path.join(themesDir, "TranscodedWallpaper");

  try {
    const stats = await fs.stat(transcodedPath);
    if (stats.isFile() && stats.size > 0) {
      return transcodedPath;
    }
  } catch (_error) {
    // Ignore missing primary wallpaper file and fall back to cache.
  }

  const cachedDir = path.join(themesDir, "CachedFiles");
  try {
    const entries = await fs.readdir(cachedDir, { withFileTypes: true });
    const candidates = await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const candidatePath = path.join(cachedDir, entry.name);
          try {
            const stats = await fs.stat(candidatePath);
            if (!stats.isFile() || stats.size === 0) {
              return null;
            }

            return { path: candidatePath, size: stats.size };
          } catch (_err) {
            return null;
          }
        }),
    );

    const sorted = candidates
      .filter(Boolean)
      .sort((left, right) => right.size - left.size);

    return sorted.length > 0 ? sorted[0].path : null;
  } catch (_error) {
    return null;
  }
};

const clampRectToBounds = (rect, maxWidth, maxHeight) => {
  if (!rect) {
    return null;
  }

  const clampedX = Math.max(0, Math.min(rect.x, maxWidth));
  const clampedY = Math.max(0, Math.min(rect.y, maxHeight));
  const remainingWidth = Math.max(0, maxWidth - clampedX);
  const remainingHeight = Math.max(0, maxHeight - clampedY);
  const clampedWidth = Math.min(rect.width, remainingWidth);
  const clampedHeight = Math.min(rect.height, remainingHeight);

  if (clampedWidth <= 0 || clampedHeight <= 0) {
    return null;
  }

  return {
    x: Math.round(clampedX),
    y: Math.round(clampedY),
    width: Math.round(clampedWidth),
    height: Math.round(clampedHeight),
  };
};

const cropWallpaperToDisplay = (wallpaperImage, targetDisplay, displays) => {
  if (!wallpaperImage || !targetDisplay || !Array.isArray(displays)) {
    return wallpaperImage;
  }

  const { width: imageWidth, height: imageHeight } = wallpaperImage.getSize();
  if (imageWidth <= 0 || imageHeight <= 0) {
    return wallpaperImage;
  }

  const originX = Math.min(...displays.map((displayItem) => displayItem.bounds.x));
  const originY = Math.min(...displays.map((displayItem) => displayItem.bounds.y));
  const maxRight = Math.max(
    ...displays.map((displayItem) => displayItem.bounds.x + displayItem.bounds.width),
  );
  const maxBottom = Math.max(
    ...displays.map((displayItem) => displayItem.bounds.y + displayItem.bounds.height),
  );

  const virtualWidth = maxRight - originX;
  const virtualHeight = maxBottom - originY;
  if (virtualWidth <= 0 || virtualHeight <= 0) {
    return wallpaperImage;
  }

  const scaleX = imageWidth / virtualWidth;
  const scaleY = imageHeight / virtualHeight;

  const cropRect = {
    x: (targetDisplay.bounds.x - originX) * scaleX,
    y: (targetDisplay.bounds.y - originY) * scaleY,
    width: targetDisplay.bounds.width * scaleX,
    height: targetDisplay.bounds.height * scaleY,
  };

  const clampedRect = clampRectToBounds(cropRect, imageWidth, imageHeight);
  if (!clampedRect) {
    return wallpaperImage;
  }

  const cropped = wallpaperImage.crop(clampedRect);
  return cropped.isEmpty() ? wallpaperImage : cropped;
};

const captureWallpaperForDisplay = async (displayId) => {
  if (!isWindows) {
    return null;
  }

  const wallpaperPath = await resolveWindowsWallpaperFile();
  if (!wallpaperPath) {
    return null;
  }

  const wallpaperImage = await loadNativeImageFromFile(wallpaperPath);
  if (!wallpaperImage) {
    return null;
  }

  const displays = screen.getAllDisplays();
  if (!displays.length) {
    return null;
  }

  const targetDisplay =
    (displayId &&
      displays.find((displayItem) => String(displayItem.id) === String(displayId))) ||
    screen.getPrimaryDisplay();

  if (!targetDisplay) {
    return null;
  }

  const cropped = cropWallpaperToDisplay(wallpaperImage, targetDisplay, displays);
  const finalImage = cropped.isEmpty() ? wallpaperImage : cropped;
  const { width, height } = finalImage.getSize();

  if (!width || !height) {
    return null;
  }

  const dataURL = `data:image/png;base64,${finalImage.toPNG().toString("base64")}`;

  return {
    id: `wallpaper:${targetDisplay.id}`,
    name:
      targetDisplay.label ||
      targetDisplay.name ||
      `Display ${String(targetDisplay.id)}`,
    type: "screen",
    displayId: String(targetDisplay.id),
    width,
    height,
    dataURL,
    appIcon: null,
  };
};

const listSources = async () => {
  const thumbnailSize = computeThumbnailSize();
  const rawSources = await desktopCapturer.getSources({
    types: ["window", "screen"],
    fetchWindowIcons: true,
    thumbnailSize,
  });

  return rawSources.map((source) => {
    const isWindow = source.id.startsWith("window:");
    const thumbnail =
      source.thumbnail && !source.thumbnail.isEmpty()
        ? source.thumbnail.toDataURL()
        : null;
    const appIcon =
      source.appIcon && !source.appIcon.isEmpty()
        ? source.appIcon.resize({ width: 48, height: 48 }).toDataURL()
        : null;

    return {
      id: source.id,
      name: source.name,
      type: isWindow ? "window" : "screen",
      displayId: source.display_id || null,
      thumbnail,
      appIcon,
    };
  });
};

const captureSource = async (sourceId) => {
  const thumbnailSize = computeThumbnailSize();
  const rawSources = await desktopCapturer.getSources({
    types: ["window", "screen"],
    fetchWindowIcons: true,
    thumbnailSize,
  });

  const source = rawSources.find((item) => item.id === sourceId);

  if (!source) {
    throw new Error(`Source with id ${sourceId} not found.`);
  }

  if (!source.thumbnail || source.thumbnail.isEmpty()) {
    throw new Error(
      "Unable to capture this source. The captured thumbnail was empty.",
    );
  }

  const { width, height } = source.thumbnail.getSize();

  return {
    id: source.id,
    name: source.name,
    type: source.id.startsWith("window:") ? "window" : "screen",
    displayId: source.display_id || null,
    width,
    height,
    dataURL: source.thumbnail.toDataURL(),
    appIcon:
      source.appIcon && !source.appIcon.isEmpty()
        ? source.appIcon.resize({ width: 48, height: 48 }).toDataURL()
        : null,
  };
};

const saveImageToDisk = async ({ dataURL, defaultPath }) => {
  if (!dataURL || typeof dataURL !== "string") {
    throw new Error("Invalid image payload provided.");
  }

  const suggestedName =
    defaultPath ||
    `CleanShot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`;

  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Save Screenshot",
    defaultPath: suggestedName,
    filters: [{ name: "PNG", extensions: ["png"] }],
  });

  if (canceled || !filePath) {
    return { canceled: true };
  }

  const base64 = dataURL.replace(/^data:image\/\w+;base64,/, "");
  const buffer = Buffer.from(base64, "base64");

  await fs.writeFile(filePath, buffer);

  return { canceled: false, filePath };
};

const registerIpcHandlers = () => {
  ipcMain.handle("sources:list", async () => {
    return listSources();
  });

  ipcMain.handle("sources:capture", async (_event, sourceId) => {
    return captureSource(sourceId);
  });

  ipcMain.handle("desktop:wallpaper", async (_event, payload = {}) => {
    const {
      sourceId = null,
      displayId = null,
      name: requestedName = null,
    } = payload || {};

    try {
      const wallpaperCapture = await captureWallpaperForDisplay(displayId);

      if (wallpaperCapture) {
        return {
          ...wallpaperCapture,
          id: sourceId || wallpaperCapture.id,
          name: requestedName || wallpaperCapture.name,
        };
      }
    } catch (error) {
      console.warn("Failed to retrieve wallpaper capture", error);
    }

    if (sourceId) {
      return captureSource(sourceId);
    }

    throw new Error("Unable to capture desktop wallpaper.");
  });

  ipcMain.handle("file:save-image", async (_event, payload) => {
    return saveImageToDisk(payload);
  });
};

const createMainWindow = async () => {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1140,
    minHeight: 720,
    backgroundColor: "#0d101f",
    title: "CleanShot Studio",
    autoHideMenuBar: true,
    frame: isMac ? false : true,
    titleBarStyle: isMac ? "hiddenInset" : "default",
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      devTools: true,
    },
  });

  // Titlebar overlay is only valid when enabled via BrowserWindow options (frame: false + titleBarStyle + titleBarOverlay).
  // This app uses the standard framed title bar on Windows, so skip overlay to avoid runtime errors.
  // If you later enable overlay in BrowserWindow options, flip the condition below to true.
  if (isWindows && false) {
    try {
      mainWindow.setTitleBarOverlay({
        color: "#0d101f",
        symbolColor: "#f5f7ff",
        height: 36,
      });
    } catch (_err) {
      // Overlay not enabled or unsupported; ignore.
    }
  }

  await mainWindow.loadFile(resolveRendererFile("index.html"));

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });
};

electron.app.whenReady()
  .then(async () => {
    if (isWindows) {
      electron.app.setAppUserModelId("CleanShotStudio");
    }

    registerIpcHandlers();
    await createMainWindow();

    electron.app.on("activate", async () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        await createMainWindow();
      }
    });
  })
  .catch((err) => {
    console.error("Failed to initialize application", err);
  });

electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
