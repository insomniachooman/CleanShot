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
  Menu,
} = electron;
const { beginSnippingSession } = require("./snipping-session");

let mainWindow = undefined;
let mainWindowCaptureMetadata = null;

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";

const handleDevToolsOpened = () => {
  console.warn(
    "Developer tools detected. Terminating application for security.",
  );
  electron.app.quit();
};

electron.app.on("browser-window-created", (_event, window) => {
  if (!window || typeof window.on !== "function") {
    return;
  }

  if (isWindows) {
    if (typeof window.setMenuBarVisibility === "function") {
      window.setMenuBarVisibility(false);
    }
    if (typeof window.removeMenu === "function") {
      window.removeMenu();
    }
  }

  window.webContents.on("devtools-opened", handleDevToolsOpened);
});

const DEFAULT_WALLPAPER_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".bmp",
  ".jfif",
  ".webp",
]);
const MAX_DEFAULT_WALLPAPERS = 24;
const MAX_CUSTOM_BACKGROUNDS = 24;
const CUSTOM_BACKGROUND_DIRNAME = "custom-backgrounds";
const CUSTOM_BACKGROUND_INDEX_FILE = "index.json";
const SUPPORTED_CUSTOM_BACKGROUND_MIME = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
]);

const resolveRendererFile = (filename) =>
  path.join(__dirname, "../renderer", filename);

const resolveCustomBackgroundRoot = () => {
  const userData = electron.app.getPath("userData");
  return path.join(userData, CUSTOM_BACKGROUND_DIRNAME);
};

const ensureCustomBackgroundDirectory = async () => {
  const root = resolveCustomBackgroundRoot();
  await fs.mkdir(root, { recursive: true });
  return root;
};

const readCustomBackgroundIndex = async () => {
  const root = await ensureCustomBackgroundDirectory();
  const indexPath = path.join(root, CUSTOM_BACKGROUND_INDEX_FILE);
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed && Array.isArray(parsed.entries)) {
      return parsed.entries;
    }
  } catch (_err) {
    // missing index falls back to empty collection
  }
  return [];
};

const writeCustomBackgroundIndex = async (entries) => {
  const root = await ensureCustomBackgroundDirectory();
  const indexPath = path.join(root, CUSTOM_BACKGROUND_INDEX_FILE);
  const payload = JSON.stringify({ entries }, null, 2);
  await fs.writeFile(indexPath, payload, "utf8");
};

const sanitizeBackgroundLabel = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    return "Custom background";
  }
  return value.replace(/\s+/g, " ").trim().slice(0, 80);
};

const parseImageDataUrl = (dataURL) => {
  if (typeof dataURL !== "string" || !dataURL.startsWith("data:image")) {
    throw new Error("Unsupported image format.");
  }

  const match = /^data:(image\/[a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(
    dataURL,
  );
  if (!match) {
    throw new Error("Invalid image payload.");
  }

  const mime = match[1];
  const base64 = match[2];
  const extension = SUPPORTED_CUSTOM_BACKGROUND_MIME.get(mime) || ".png";
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) {
    throw new Error("Image payload was empty.");
  }

  return { mime, extension, buffer };
};

const saveCustomBackgroundImage = async ({ dataURL, name }) => {
  const { mime, extension, buffer } = parseImageDataUrl(dataURL);
  const root = await ensureCustomBackgroundDirectory();
  const id = `custom-background-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const fileName = `${id}${extension}`;
  const filePath = path.join(root, fileName);

  await fs.writeFile(filePath, buffer);

  const entry = {
    id,
    name: sanitizeBackgroundLabel(name),
    mime,
    fileName,
    createdAt: new Date().toISOString(),
  };

  const existing = await readCustomBackgroundIndex();
  const nextEntries = [entry, ...existing.filter((item) => item.id !== entry.id)];

  if (nextEntries.length > MAX_CUSTOM_BACKGROUNDS) {
    const surplus = nextEntries.slice(MAX_CUSTOM_BACKGROUNDS);
    for (const oldEntry of surplus) {
      try {
        await fs.unlink(path.join(root, oldEntry.fileName));
      } catch (_unlinkError) {
        // ignore stale files that cannot be removed
      }
    }
    nextEntries.length = MAX_CUSTOM_BACKGROUNDS;
  }

  await writeCustomBackgroundIndex(nextEntries);

  return {
    ...entry,
    dataURL: `data:${mime};base64,${buffer.toString("base64")}`,
  };
};

const listCustomBackgroundImages = async () => {
  const root = await ensureCustomBackgroundDirectory();
  const entries = await readCustomBackgroundIndex();
  const available = [];
  const missing = new Set();

  for (const entry of entries) {
    const filePath = path.join(root, entry.fileName);
    try {
      const buffer = await fs.readFile(filePath);
      if (!buffer.length) {
        throw new Error("Empty image file.");
      }
      available.push({
        ...entry,
        dataURL: `data:${entry.mime};base64,${buffer.toString("base64")}`,
      });
    } catch (_err) {
      missing.add(entry.id);
    }
  }

  if (missing.size > 0) {
    const filtered = entries.filter((entry) => !missing.has(entry.id));
    await writeCustomBackgroundIndex(filtered);
  }

  return available;
};

const computeThumbnailSize = () => {
  const display = screen.getPrimaryDisplay();
  const scaleFactor = display?.scaleFactor || 1;
  const maxDimension = 3200;
  const baseWidth =
    display?.size?.width || display?.bounds?.width || maxDimension;
  const baseHeight =
    display?.size?.height || display?.bounds?.height || maxDimension;
  const width = Math.max(
    1,
    Math.min(Math.floor(baseWidth * scaleFactor), maxDimension),
  );
  const height = Math.max(
    1,
    Math.min(Math.floor(baseHeight * scaleFactor), maxDimension),
  );

  return { width, height };
};

const parseSourceId = (sourceId) => {
  if (typeof sourceId !== "string" || sourceId.trim() === "") {
    return null;
  }

  const [type, handle, display] = sourceId.split(":");
  if (!type || !handle) {
    return null;
  }

  return {
    type,
    handle,
    display: display ?? null,
  };
};

const computeWindowHandleToken = (browserWindow) => {
  if (!browserWindow || browserWindow.isDestroyed?.()) {
    return null;
  }

  const handleBuffer = browserWindow.getNativeWindowHandle();
  if (!handleBuffer || handleBuffer.length === 0) {
    return null;
  }

  try {
    if (
      typeof handleBuffer.readBigUInt64LE === "function" &&
      handleBuffer.length >= 8
    ) {
      return handleBuffer.readBigUInt64LE(0).toString();
    }

    if (handleBuffer.length >= 4) {
      return handleBuffer.readUInt32LE(0).toString();
    }

    let accumulator = 0n;
    for (let index = 0; index < handleBuffer.length; index += 1) {
      const byte = BigInt(handleBuffer[index] ?? 0);
      accumulator |= byte << BigInt(index * 8);
    }

    return accumulator > 0n ? accumulator.toString() : null;
  } catch (error) {
    console.warn("Failed to read native window handle", error);
    return null;
  }
};

const ensureMainWindowMetadataHandle = () => {
  if (!mainWindow || mainWindow.isDestroyed?.()) {
    mainWindowCaptureMetadata = null;
    return;
  }

  if (mainWindowCaptureMetadata?.handle) {
    return;
  }

  const handleToken = computeWindowHandleToken(mainWindow);
  if (!handleToken) {
    return;
  }

  const fallbackTitle = mainWindow.getTitle?.() || "Application Window";
  mainWindowCaptureMetadata = {
    id: `window:${handleToken}:0`,
    handle: handleToken,
    name: mainWindowCaptureMetadata?.name || fallbackTitle,
    displayId: mainWindowCaptureMetadata?.displayId || null,
    appIcon: mainWindowCaptureMetadata?.appIcon || null,
  };
};

const captureBrowserWindow = async (targetWindow, metadata = {}) => {
  if (!targetWindow || targetWindow.isDestroyed?.()) {
    throw new Error("Target window is unavailable for capture.");
  }

  const handleToken =
    metadata.handle || computeWindowHandleToken(targetWindow);

  try {
    const image = await targetWindow.capturePage();
    if (!image || image.isEmpty()) {
      throw new Error("Unable to capture this window.");
    }

    const { width, height } = image.getSize();
    if (!width || !height) {
      throw new Error("Captured window image was empty.");
    }

    return {
      id: metadata.id || (handleToken ? `window:${handleToken}:0` : null),
      name:
        metadata.name ||
        targetWindow.getTitle?.() ||
        "Application Window",
      type: "window",
      displayId: metadata.displayId || null,
      width,
      height,
      dataURL: image.toDataURL(),
      appIcon: metadata.appIcon || null,
      wallpaperOnly: false,
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Failed to capture application window.");
  }
};

const updateMainWindowCaptureMetadata = (sources = []) => {
  if (!mainWindow || mainWindow.isDestroyed?.()) {
    mainWindowCaptureMetadata = null;
    return;
  }

  const handleToken = computeWindowHandleToken(mainWindow);
  if (!handleToken) {
    mainWindowCaptureMetadata = null;
    return;
  }

  const matchingSource = sources.find((source) => {
    if (!source?.id) {
      return false;
    }

    const parsed = parseSourceId(source.id);
    return parsed?.type === "window" && parsed.handle === handleToken;
  });

  const windowTitle = mainWindow.getTitle?.() || "Application Window";
  if (matchingSource) {
    mainWindowCaptureMetadata = {
      id: matchingSource.id,
      handle: handleToken,
      name: matchingSource.name || windowTitle,
      displayId: matchingSource.displayId || null,
      appIcon: matchingSource.appIcon || null,
    };
    return;
  }

  mainWindowCaptureMetadata = {
    id: `window:${handleToken}:0`,
    handle: handleToken,
    name: windowTitle,
    displayId: null,
    appIcon: null,
  };
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

const resolveWindowsWallpaperRoots = () => {
  if (!isWindows) {
    return [];
  }

  const windir = process.env.WINDIR || "C:\\Windows";
  return [
    path.join(windir, "Web", "Wallpaper"),
    path.join(windir, "Web", "Screen"),
  ].filter(Boolean);
};

const enumerateWallpaperFiles = async (directory) => {
  try {
    const dirents = await fs.readdir(directory, { withFileTypes: true });
    const files = await Promise.all(
      dirents.map(async (entry) => {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          return enumerateWallpaperFiles(entryPath);
        }

        if (!entry.isFile()) {
          return [];
        }

        const extension = path.extname(entry.name || "").toLowerCase();
        if (!DEFAULT_WALLPAPER_EXTENSIONS.has(extension)) {
          return [];
        }

        try {
          const stats = await fs.stat(entryPath);
          if (!stats.isFile() || stats.size === 0) {
            return [];
          }
        } catch (_statError) {
          return [];
        }

        return [entryPath];
      }),
    );

    return files.flat();
  } catch (_error) {
    return [];
  }
};

let defaultWallpaperCache = null;

const listDefaultWallpapers = async () => {
  if (!isWindows) {
    return [];
  }

  if (defaultWallpaperCache) {
    return defaultWallpaperCache;
  }

  const roots = resolveWindowsWallpaperRoots();
  const discovered = await Promise.all(
    roots.map(async (root) => enumerateWallpaperFiles(root)),
  );

  const uniquePaths = Array.from(new Set(discovered.flat())).sort((left, right) =>
    left.localeCompare(right),
  );
  const limitedPaths = uniquePaths.slice(0, MAX_DEFAULT_WALLPAPERS);

  const wallpapers = [];

  for (let index = 0; index < limitedPaths.length; index += 1) {
    const filePath = limitedPaths[index];
    try {
      const image = nativeImage.createFromPath(filePath);
      if (!image || image.isEmpty()) {
        continue;
      }

      const { width, height } = image.getSize();
      if (!width || !height) {
        continue;
      }

      wallpapers.push({
        id: `default-wallpaper:${index}`,
        name: path.basename(filePath, path.extname(filePath)),
        width,
        height,
        dataURL: image.toDataURL(),
      });
    } catch (error) {
      console.warn("Unable to load default wallpaper", filePath, error);
    }
  }

  defaultWallpaperCache = wallpapers;
  return wallpapers;
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
    wallpaperOnly: true,
  };
};

const listSources = async () => {
  const thumbnailSize = computeThumbnailSize();
  const rawSources = await desktopCapturer.getSources({
    types: ["window", "screen"],
    fetchWindowIcons: true,
    thumbnailSize,
  });

  const mappedSources = rawSources.map((source) => {
    const isWindow = source.id.startsWith("window:");
    const thumbnail =
      source.thumbnail && !source.thumbnail.isEmpty()
        ? source.thumbnail.toDataURL()
        : null;
    const appIcon =
      source.appIcon && !source.appIcon.isEmpty()
        ? source.appIcon.resize({ width: 48, height: 48 }).toDataURL()
        : null;
    const displayId =
      source.display_id !== undefined && source.display_id !== null
        ? String(source.display_id)
        : null;
    const rawName =
      typeof source.name === "string" ? source.name.trim() : "";
    const fallbackName = isWindow
      ? "Untitled Window"
      : displayId
        ? `Display ${displayId}`
        : "Display";
    const name = rawName.length > 0 ? rawName : fallbackName;

    return {
      id: source.id,
      name,
      type: isWindow ? "window" : "screen",
      displayId,
      thumbnail,
      appIcon,
    };
  });

  updateMainWindowCaptureMetadata(mappedSources);

  return mappedSources;
};

const captureSource = async (sourceId) => {
  if (!sourceId) {
    throw new Error("A source id is required to capture.");
  }

  const thumbnailSize = computeThumbnailSize();
  const captureTypes = ["window", "screen"];

  const locateSource = async (types) => {
    const sources = await desktopCapturer.getSources({
      types,
      fetchWindowIcons: types.includes("window"),
      thumbnailSize,
    });
    return sources.find((item) => item.id === sourceId);
  };

  let source = await locateSource(captureTypes);

  if (!source) {
    const isWindowSource =
      typeof sourceId === "string" && sourceId.startsWith("window:");
    const retryTypes = [isWindowSource ? "window" : "screen"];
    source = await locateSource(retryTypes);
  }

  if (!source) {
    ensureMainWindowMetadataHandle();

    const parsedSourceId = parseSourceId(sourceId);
    const isWindowSourceId =
      parsedSourceId?.type === "window" ||
      (mainWindowCaptureMetadata?.id &&
        sourceId === mainWindowCaptureMetadata.id);
    const matchesMainWindow =
      mainWindow &&
      !mainWindow.isDestroyed?.() &&
      isWindowSourceId &&
      mainWindowCaptureMetadata &&
      ((mainWindowCaptureMetadata.id &&
        mainWindowCaptureMetadata.id === sourceId) ||
        (mainWindowCaptureMetadata.handle &&
          parsedSourceId?.handle &&
          parsedSourceId.handle === mainWindowCaptureMetadata.handle));

    if (matchesMainWindow) {
      if (!mainWindowCaptureMetadata.id && sourceId) {
        mainWindowCaptureMetadata = {
          ...mainWindowCaptureMetadata,
          id: sourceId,
        };
      }

      return captureBrowserWindow(mainWindow, mainWindowCaptureMetadata);
    }

    throw new Error(`Source with id ${sourceId} not found.`);
  }

  // Upgrade to native-size thumbnail for this specific source to improve quality.
  // Windows rejects zero-dimension thumbnail requests via the WGC backend, so skip the upgrade there.
  const typesForNative = [source.id.startsWith("window:") ? "window" : "screen"];
  if (!isWindows) {
    try {
      const nativeSources = await desktopCapturer.getSources({
        types: typesForNative,
        fetchWindowIcons: typesForNative.includes("window"),
        // width/height of 0 asks Electron to return native-size images
        thumbnailSize: { width: 0, height: 0 },
      });
      const exact = nativeSources.find((item) => item.id === source.id);
      if (exact && exact.thumbnail && !exact.thumbnail.isEmpty()) {
        source = exact;
      }
    } catch (_nativeUpgradeError) {
      // Keep previously fetched thumbnail on failure
    }
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

const openImageFromDisk = async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Import Image",
    properties: ["openFile"],
    filters: [
      {
        name: "Images",
        extensions: Array.from(DEFAULT_WALLPAPER_EXTENSIONS).map((ext) =>
          ext.replace(/^\./, ""),
        ),
      },
    ],
  });

  if (canceled || !filePaths || filePaths.length === 0) {
    return { canceled: true };
  }

  const filePath = filePaths[0];
  const extension = path.extname(filePath).toLowerCase();

  if (!DEFAULT_WALLPAPER_EXTENSIONS.has(extension)) {
    throw new Error("Unsupported image format.");
  }

  const buffer = await fs.readFile(filePath);
  if (!buffer || buffer.length === 0) {
    throw new Error("Selected image file is empty.");
  }

  const image = nativeImage.createFromBuffer(buffer);
  if (!image || image.isEmpty()) {
    throw new Error("Unable to decode the selected image.");
  }

  const { width, height } = image.getSize();
  if (!width || !height) {
    throw new Error("Selected image has invalid dimensions.");
  }

  return {
    canceled: false,
    name: path.basename(filePath, path.extname(filePath)),
    width,
    height,
    dataURL: image.toDataURL(),
  };
};

const registerIpcHandlers = () => {
  ipcMain.handle("sources:list", async () => {
    return listSources();
  });

  ipcMain.handle("sources:capture", async (_event, sourceId) => {
    return captureSource(sourceId);
  });

  ipcMain.handle("snipping:capture-area", async () => {
    if (!mainWindow || mainWindow.isDestroyed?.()) {
      throw new Error("The editor window is unavailable for capture.");
    }

    return beginSnippingSession({ ownerWindow: mainWindow });
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

    if (sourceId && String(sourceId).startsWith("screen:")) {
      try {
        return await captureSource(sourceId);
      } catch (fallbackError) {
        console.warn(
          "Wallpaper capture fallback to desktopCapturer failed",
          fallbackError,
        );
      }
    }

    throw new Error("Unable to capture desktop wallpaper.");
  });

  ipcMain.handle("desktop:list-default-wallpapers", async () => {
    try {
      return await listDefaultWallpapers();
    } catch (error) {
      console.warn("Failed to enumerate default wallpapers", error);
      return [];
    }
  });

  ipcMain.handle("backgrounds:list-custom", async () => {
    try {
      return await listCustomBackgroundImages();
    } catch (error) {
      console.warn("Failed to list custom backgrounds", error);
      return [];
    }
  });

  ipcMain.handle("backgrounds:save-custom", async (_event, payload = {}) => {
    try {
      return await saveCustomBackgroundImage(payload);
    } catch (error) {
      console.warn("Failed to persist custom background", error);
      throw error;
    }
  });

  ipcMain.handle("file:save-image", async (_event, payload) => {
    return saveImageToDisk(payload);
  });

  ipcMain.handle("file:open-image", async () => {
    return openImageFromDisk();
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
      devTools: false,
    },
  });

  if (isWindows && typeof mainWindow.setMenuBarVisibility === "function") {
    mainWindow.setMenuBarVisibility(false);
  }

  if (mainWindow?.webContents) {
    mainWindow.webContents.on("devtools-opened", handleDevToolsOpened);
  }

  ensureMainWindowMetadataHandle();

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
    mainWindowCaptureMetadata = null;
  });
};

electron.app.whenReady()
  .then(async () => {
    if (isWindows) {
      electron.app.setAppUserModelId("CleanShotStudio");
    }

    if (Menu) {
      try {
        if (isWindows) {
          Menu.setApplicationMenu(null);
        }
      } catch (menuError) {
        console.warn("Failed to adjust application menu", menuError);
      }
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
