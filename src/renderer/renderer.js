import { initializeRecordingController } from "./recording/controller.js";
import {
  getRoundedRectPath,
  drawRoundedImage,
  drawCoverImage,
} from "./modules/canvas-utils.js";

const api = window.cleanShot;

const state = {
  sources: [],
  filterValue: "",
  selectedSourceId: null,
  selectedCapture: null,
  screenshotImage: null,
  backgroundMode: "color",
  backgroundColor: "#0f172a",
  padding: 80,
  withShadow: true,
  customImage: null,
  customImageName: "",
  desktopImages: new Map(),
  backgroundDesktopId: null,
  desktopGalleryOrder: [],
  desktopGalleryIndex: 0,
  defaultWallpapersLoaded: false,
  isFetchingDefaultWallpapers: false,
  isLoadingSources: false,
  renderQueued: false,
  lastRenderDataUrl: null,
  isCapturing: false,
  customBackgrounds: [],
  customBackgroundMap: new Map(),
  activeCustomBackgroundId: null,
  colorInputMode: "hex",
};

const SUPPORTED_IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".bmp", ".webp", ".jfif"];

const elements = {
  sourceList: document.getElementById("sourceList"),
  sourceFilterInput: document.getElementById("sourceFilterInput"),
  refreshButton: document.getElementById("refreshSourcesBtn"),
  areaCaptureBtn: document.getElementById("areaCaptureBtn"),
  importImageBtn: document.getElementById("importImageBtn"),
  previewCanvas: document.getElementById("previewCanvas"),
  previewPlaceholder: document.getElementById("previewPlaceholder"),
  previewLoading: document.getElementById("previewLoading"),
  previewStage: document.querySelector(".preview-stage"),
  paddingSlider: document.getElementById("paddingSlider"),
  paddingValueLabel: document.getElementById("paddingValueLabel"),
  shadowToggle: document.getElementById("shadowToggle"),
  shadowSwitch: document.querySelector(".toggle-field .switch"),
  statusMessage: document.getElementById("statusMessage"),
  saveButton: document.getElementById("saveImageBtn"),
  segmentButtons: Array.from(
    document.querySelectorAll(".segment-control .segment"),
  ),
  colorPickerField: document.getElementById("colorPickerField"),
  backgroundColorInput: document.getElementById("backgroundColorInput"),
  colorAdvanced: document.getElementById("colorAdvanced"),
  colorModeHexBtn: document.getElementById("colorModeHex"),
  colorModeRgbBtn: document.getElementById("colorModeRgb"),
  colorModeHslBtn: document.getElementById("colorModeHsl"),
  colorValueInput: document.getElementById("colorValueInput"),
  imagePickerField: document.getElementById("imagePickerField"),
  chooseImageBtn: document.getElementById("chooseImageBtn"),
  backgroundImageInput: document.getElementById("backgroundImageInput"),
  imageNameLabel: document.getElementById("imageNameLabel"),
  desktopGalleryControls: document.getElementById("desktopGalleryControls"),
  desktopPrevBtn: document.getElementById("desktopPrevBtn"),
  desktopNextBtn: document.getElementById("desktopNextBtn"),
  desktopGalleryLabel: document.getElementById("desktopGalleryLabel"),
  savedBackgroundsSection: document.getElementById("savedBackgroundsSection"),
  savedBackgroundsList: document.getElementById("savedBackgroundsList"),
  desktopImportControl: document.getElementById("desktopImportControl"),
  desktopImportBtn: document.getElementById("desktopImportBtn"),
  desktopImportInput: document.getElementById("desktopImportInput"),
};

let recordingController = null;

const visualStateListeners = new Set();

const getVisualConfigSnapshot = () => {
  const desktopImageEntry =
    state.backgroundDesktopId && state.desktopImages.has(state.backgroundDesktopId)
      ? state.desktopImages.get(state.backgroundDesktopId)
      : null;

  return {
    backgroundMode: state.backgroundMode,
    backgroundColor: state.backgroundColor,
    padding: state.padding,
    withShadow: state.withShadow,
    customImage: state.customImage,
    customImageName: state.customImageName,
    desktopImage: desktopImageEntry?.image ?? null,
    desktopImageId: state.backgroundDesktopId,
    screenshotImage: state.screenshotImage,
  };
};

const notifyVisualConfigChanged = () => {
  const snapshot = getVisualConfigSnapshot();
  visualStateListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (error) {
      console.warn("Visual state listener failed", error);
    }
  });
};

window.cleanShotVisualState = {
  getSnapshot: getVisualConfigSnapshot,
  subscribe(listener) {
    if (typeof listener !== "function") {
      return () => {};
    }
    visualStateListeners.add(listener);
    listener(getVisualConfigSnapshot());
    return () => {
      visualStateListeners.delete(listener);
    };
  },
};

const getReadableSourceName = (source) => {
  if (!source) {
    return "Untitled window";
  }

  const rawName =
    typeof source.name === "string" ? source.name.trim() : "";
  if (rawName.length > 0) {
    return rawName;
  }

  if ((source.type || "").toLowerCase() === "screen") {
    const displayId =
      source.displayId !== undefined && source.displayId !== null
        ? String(source.displayId).trim()
        : "";
    return displayId ? `Display ${displayId}` : "Display";
  }

  return "Untitled window";
};

const canvasContext = elements.previewCanvas.getContext("2d");
let statusTimeoutHandle = undefined;

const setStatus = (message, tone = "neutral", persistMs = 3800) => {
  if (!elements.statusMessage) {
    return;
  }

  elements.statusMessage.textContent = message;
  elements.statusMessage.classList.remove("success", "error");

  if (tone === "success") {
    elements.statusMessage.classList.add("success");
  } else if (tone === "error") {
    elements.statusMessage.classList.add("error");
  }

  if (statusTimeoutHandle) {
    clearTimeout(statusTimeoutHandle);
    statusTimeoutHandle = undefined;
  }

  if (message && tone !== "error" && persistMs > 0) {
    statusTimeoutHandle = window.setTimeout(() => {
      elements.statusMessage.textContent = "";
      elements.statusMessage.classList.remove("success", "error");
      statusTimeoutHandle = undefined;
    }, persistMs);
  }
};

const togglePreviewLoading = (show) => {
  elements.previewLoading.style.display = show ? "flex" : "none";
};

const showPlaceholder = (show) => {
  elements.previewPlaceholder.style.display = show ? "block" : "none";
  elements.previewCanvas.style.display = show ? "none" : "block";
};

const syncShadowSwitch = () => {
  if (!elements.shadowSwitch) {
    return;
  }

  if (state.withShadow) {
    elements.shadowSwitch.classList.add("is-active");
  } else {
    elements.shadowSwitch.classList.remove("is-active");
  }
};

const MAX_RENDERER_CUSTOM_BACKGROUNDS = 24;

const upsertCustomBackgroundEntry = (entry) => {
  if (!entry?.id) {
    return;
  }

  const existingIndex = state.customBackgrounds.findIndex(
    (item) => item.id === entry.id,
  );

  if (existingIndex >= 0) {
    state.customBackgrounds.splice(existingIndex, 1);
  }

  state.customBackgrounds.unshift(entry);
  state.customBackgroundMap.set(entry.id, entry);

  if (state.customBackgrounds.length > MAX_RENDERER_CUSTOM_BACKGROUNDS) {
    const removed = state.customBackgrounds.splice(
      MAX_RENDERER_CUSTOM_BACKGROUNDS,
      state.customBackgrounds.length - MAX_RENDERER_CUSTOM_BACKGROUNDS,
    );
    removed.forEach((item) => {
      if (item?.id) {
        state.customBackgroundMap.delete(item.id);
      }
    });
  }
};

const renderCustomBackgroundGallery = () => {
  if (!elements.savedBackgroundsSection || !elements.savedBackgroundsList) {
    return;
  }

  const shouldShow =
    state.backgroundMode === "image" && state.customBackgrounds.length > 0;
  elements.savedBackgroundsSection.classList.toggle("is-hidden", !shouldShow);

  elements.savedBackgroundsList.innerHTML = "";
  if (!shouldShow) {
    return;
  }

  const fragment = document.createDocumentFragment();
  state.customBackgrounds.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "custom-bg-thumb";
    button.dataset.id = entry.id;
    if (entry.id === state.activeCustomBackgroundId) {
      button.classList.add("active");
    }

    const preview = document.createElement("img");
    preview.src = entry.dataURL;
    preview.alt = entry.name
      ? `${entry.name} background`
      : "Custom background preview";

    const caption = document.createElement("span");
    if (entry.name && entry.name.length > 24) {
      caption.textContent = `${entry.name.slice(0, 21)}...`;
    } else {
      caption.textContent = entry.name || "Custom";
    }

    button.appendChild(preview);
    button.appendChild(caption);
    fragment.appendChild(button);
  });

  elements.savedBackgroundsList.appendChild(fragment);
};

const setActiveCustomBackground = (id) => {
  state.activeCustomBackgroundId = id || null;
  renderCustomBackgroundGallery();
};

const applySavedCustomBackground = async (id) => {
  if (!id) {
    return;
  }

  const entry = state.customBackgroundMap.get(id);
  if (!entry) {
    return;
  }

  state.customImage = entry.image;
  state.customImageName = entry.name || "Custom background";
  elements.imageNameLabel.textContent = state.customImageName;
  setActiveCustomBackground(entry.id);
  notifyVisualConfigChanged();

  if (state.backgroundMode !== "image") {
    await handleBackgroundModeChange("image");
  } else {
    scheduleRender();
  }
};

const loadCustomBackgrounds = async () => {
  if (typeof api.listCustomBackgrounds !== "function") {
    return;
  }

  try {
    const results = await api.listCustomBackgrounds();
    const prepared = [];
    const map = new Map();

    if (Array.isArray(results)) {
      for (const entry of results) {
        if (!entry?.id || !entry?.dataURL) {
          continue;
        }

        try {
          const image = await loadImageFromDataUrl(entry.dataURL);
          const preparedEntry = {
            ...entry,
            name: entry.name || "Custom background",
            image,
          };
          prepared.push(preparedEntry);
          map.set(preparedEntry.id, preparedEntry);
        } catch (decodeError) {
          console.warn(
            "Failed to decode custom background",
            entry.id,
            decodeError,
          );
        }
      }
    }

    state.customBackgrounds = prepared.slice(
      0,
      MAX_RENDERER_CUSTOM_BACKGROUNDS,
    );
    state.customBackgroundMap = map;

    if (
      state.activeCustomBackgroundId &&
      !state.customBackgroundMap.has(state.activeCustomBackgroundId)
    ) {
      state.activeCustomBackgroundId = null;
    }

    renderCustomBackgroundGallery();
  } catch (error) {
    console.error("Unable to load custom backgrounds", error);
  }
};

const updateDesktopImportControl = () => {
  if (!elements.desktopImportControl) {
    return;
  }

  const isDesktopMode = state.backgroundMode === "desktop";
  elements.desktopImportControl.classList.toggle("is-hidden", !isDesktopMode);

  if (!isDesktopMode) {
    return;
  }

  if (elements.desktopImportBtn) {
    elements.desktopImportBtn.disabled = state.isFetchingDefaultWallpapers;
  }
};

const updateBackgroundFields = () => {
  if (elements.colorPickerField) {
    elements.colorPickerField.classList.toggle(
      "is-hidden",
      state.backgroundMode !== "color",
    );
  }
  if (elements.colorAdvanced) {
    elements.colorAdvanced.classList.toggle(
      "is-hidden",
      state.backgroundMode !== "color",
    );
  }
  if (elements.imagePickerField) {
    elements.imagePickerField.classList.toggle(
      "is-hidden",
      state.backgroundMode !== "image",
    );
  }

  updateDesktopImportControl();
  renderCustomBackgroundGallery();
  updateDesktopGalleryControls();
  updatePreviewStageBackdrop();
};

const updateSegmentControls = () => {
  elements.segmentButtons.forEach((button) => {
    const mode = button.dataset.mode;
    const isActive = mode === state.backgroundMode;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-checked", isActive ? "true" : "false");
  });
};

const updatePreviewStageBackdrop = () => {
  if (!elements.previewStage) {
    return;
  }

  elements.previewStage.classList.toggle(
    "is-transparent-preview",
    state.backgroundMode === "transparent",
  );
};

const updateDesktopGalleryControls = () => {
  if (!elements.desktopGalleryControls) {
    return;
  }

  updateDesktopImportControl();

  const isDesktopMode = state.backgroundMode === "desktop";
  const total = state.desktopGalleryOrder.length;
  const shouldShow = isDesktopMode && total > 0;

  elements.desktopGalleryControls.classList.toggle("is-hidden", !shouldShow);

  if (!shouldShow) {
    return;
  }

  if (
    !state.backgroundDesktopId ||
    !state.desktopImages.has(state.backgroundDesktopId)
  ) {
    state.backgroundDesktopId = state.desktopGalleryOrder[0] || null;
  }

  const activeId = state.backgroundDesktopId;
  if (!activeId || !state.desktopImages.has(activeId)) {
    return;
  }

  const activeIndex = state.desktopGalleryOrder.indexOf(activeId);
  const normalizedIndex = activeIndex >= 0 ? activeIndex : 0;
  state.desktopGalleryIndex = normalizedIndex;

  const entry = state.desktopImages.get(activeId);
  if (elements.desktopGalleryLabel) {
    const baseLabel =
      entry?.label ||
      entry?.capture?.name ||
      `Wallpaper ${normalizedIndex + 1}`;
    elements.desktopGalleryLabel.textContent = `${baseLabel} (${normalizedIndex + 1} of ${total})`;
  }

  const disableNav = total < 2 || state.isFetchingDefaultWallpapers;
  if (elements.desktopPrevBtn) {
    elements.desktopPrevBtn.disabled = disableNav;
  }
  if (elements.desktopNextBtn) {
    elements.desktopNextBtn.disabled = disableNav;
  }

  if (elements.desktopGalleryLabel) {
    elements.desktopGalleryLabel.title = entry?.label || entry?.capture?.name || "";
  }
};

const addDesktopImageEntry = (id, image, capture, options = {}) => {
  if (!id || !image) {
    return;
  }

  const {
    label = null,
    source = "default",
    preferFront = false,
  } = options;

  const existingIndex = state.desktopGalleryOrder.indexOf(id);
  if (existingIndex >= 0) {
    state.desktopGalleryOrder.splice(existingIndex, 1);
  }

  if (preferFront) {
    state.desktopGalleryOrder.unshift(id);
  } else {
    state.desktopGalleryOrder.push(id);
  }

  state.desktopImages.set(id, {
    image,
    capture: capture || null,
    label: label || capture?.name || "Wallpaper",
    source,
  });

  updateDesktopGalleryControls();
};

const setDesktopBackgroundById = (id) => {
  if (!id || !state.desktopImages.has(id)) {
    return false;
  }

  state.backgroundDesktopId = id;
  const index = state.desktopGalleryOrder.indexOf(id);
  state.desktopGalleryIndex = index >= 0 ? index : 0;
  updateDesktopGalleryControls();
  notifyVisualConfigChanged();
  return true;
};

const ensureDefaultWallpapersLoaded = async () => {
  if (
    state.defaultWallpapersLoaded ||
    state.isFetchingDefaultWallpapers ||
    typeof api.listDefaultDesktopWallpapers !== "function"
  ) {
    updateDesktopGalleryControls();
    return;
  }

  state.isFetchingDefaultWallpapers = true;
  try {
    const wallpapers = await api.listDefaultDesktopWallpapers();
    if (Array.isArray(wallpapers)) {
      for (const wallpaper of wallpapers) {
        if (!wallpaper?.id || !wallpaper?.dataURL) {
          continue;
        }

        try {
          const image = await loadImageFromDataUrl(wallpaper.dataURL);
          addDesktopImageEntry(wallpaper.id, image, wallpaper, {
            label: wallpaper.name || "Wallpaper",
            source: "default",
          });
        } catch (decodeError) {
          console.warn("Failed to prepare wallpaper image", wallpaper.id, decodeError);
        }
      }
    }
    state.defaultWallpapersLoaded = true;
  } catch (error) {
    console.error("Unable to load default wallpapers", error);
    setStatus("Unable to load default Windows wallpapers.", "error", 6000);
  } finally {
    state.isFetchingDefaultWallpapers = false;
    updateDesktopGalleryControls();
  }
};

const cycleDesktopBackground = (direction) => {
  if (!state.desktopGalleryOrder.length) {
    return;
  }

  const total = state.desktopGalleryOrder.length;
  const currentIndex = state.desktopGalleryOrder.indexOf(
    state.backgroundDesktopId,
  );
  const normalizedIndex = currentIndex >= 0 ? currentIndex : 0;
  const nextIndex = (normalizedIndex + direction + total) % total;
  const nextId = state.desktopGalleryOrder[nextIndex];
  if (setDesktopBackgroundById(nextId)) {
    scheduleRender();
    const entry = state.desktopImages.get(nextId);
    if (entry?.label) {
      setStatus(`Wallpaper: ${entry.label}`, "neutral", 2200);
    }
  }
};

const isSupportedImageFile = (file) => {
  if (!file) {
    return false;
  }

  if (file.type && file.type.startsWith("image/")) {
    return true;
  }

  const fileName =
    typeof file.name === "string" ? file.name.toLowerCase() : "";
  return SUPPORTED_IMAGE_EXTENSIONS.some((ext) => fileName.endsWith(ext));
};

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("No file provided."));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const { result } = reader;
      if (typeof result === "string") {
        resolve(result);
      } else {
        reject(new Error("Unsupported file result."));
      }
    };
    reader.onerror = () => {
      reject(reader.error || new Error("Unable to read file."));
    };

    try {
      reader.readAsDataURL(file);
    } catch (error) {
      reject(error);
    }
  });

const filterSources = (sources, query) => {
  if (!query) {
    return sources;
  }

  const lowerQuery = query.toLowerCase();
  return sources.filter((source) => {
    const name = getReadableSourceName(source);
    return name.toLowerCase().includes(lowerQuery);
  });
};

const createSourceCard = (source) => {
  const button = document.createElement("button");
  button.className = "source-card";
  button.type = "button";
  button.dataset.id = source.id;
  if (source.id === state.selectedSourceId) {
    button.classList.add("active");
  }

  const displayName = getReadableSourceName(source);

  const thumb = document.createElement("div");
  thumb.className = "source-thumb";

  if (source.thumbnail) {
    const img = document.createElement("img");
    img.src = source.thumbnail;
    img.alt = `${displayName} preview`;
    thumb.appendChild(img);
  } else {
    const fallback = document.createElement("div");
    fallback.className = "fallback-icon";
        fallback.textContent = source.type === "screen" ? "[Display]" : "[Window]";
    thumb.appendChild(fallback);
  }

  const meta = document.createElement("div");
  meta.className = "source-meta";

  const title = document.createElement("div");
  title.className = "source-title";
  title.textContent =
    displayName.length > 48
      ? `${displayName.slice(0, 45)}...`
      : displayName;

  const subtitle = document.createElement("div");
  subtitle.className = "source-subtitle";

  const typeBadge = document.createElement("span");
  typeBadge.className = "source-badge";
  typeBadge.textContent =
    source.type === "screen" ? "Display" : "Window";

  subtitle.appendChild(typeBadge);
  if (source.displayId) {
    const displayLabel = document.createElement("span");
    displayLabel.textContent = `Display ${source.displayId}`;
    subtitle.appendChild(displayLabel);
  }

  meta.appendChild(title);
  meta.appendChild(subtitle);

  button.appendChild(thumb);
  button.appendChild(meta);
  return button;
};

const renderSourceList = () => {
  if (!elements.sourceList) {
    return;
  }

  elements.sourceList.innerHTML = "";

  const visibleSources = filterSources(state.sources, state.filterValue);

  if (visibleSources.length === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "preview-placeholder";
    emptyState.innerHTML = `
      <h3>No matching windows</h3>
      <p>Try refreshing the list or search for a different window title.</p>
    `;
    elements.sourceList.appendChild(emptyState);
    return;
  }

  const fragment = document.createDocumentFragment();
  visibleSources.forEach((source) => {
    fragment.appendChild(createSourceCard(source));
  });

  elements.sourceList.appendChild(fragment);
};

const loadImageFromDataUrl = (dataUrl) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });

// Color utils and advanced input syncing
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const hexToRgb = (hex) => {
  if (typeof hex !== "string") return null;
  let v = hex.trim().toLowerCase();
  if (v.startsWith("#")) v = v.slice(1);
  if (v.length === 3) {
    const r = v[0], g = v[1], b = v[2];
    v = `${r}${r}${g}${g}${b}${b}`;
  }
  if (!/^[0-9a-f]{6}$/i.test(v)) return null;
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  return { r, g, b };
};

const rgbToHex = ({ r, g, b }) => {
  const toHex = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

const parseRgbString = (input) => {
  if (typeof input !== "string") return null;
  const m = input.trim().toLowerCase().match(/^rgba?\(\s*([+-]?\d{1,3})\s*,\s*([+-]?\d{1,3})\s*,\s*([+-]?\d{1,3})\s*(?:,\s*([0-9.]+)\s*)?\)$/i);
  if (!m) return null;
  const r = clamp(parseInt(m[1], 10), 0, 255);
  const g = clamp(parseInt(m[2], 10), 0, 255);
  const b = clamp(parseInt(m[3], 10), 0, 255);
  return { r, g, b };
};

const hslToRgb = (h, s, l) => {
  const hh = ((h % 360) + 360) % 360;
  const ss = clamp(s, 0, 1);
  const ll = clamp(l, 0, 1);
  const c = (1 - Math.abs(2 * ll - 1)) * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = ll - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (hh < 60) [r1, g1, b1] = [c, x, 0];
  else if (hh < 120) [r1, g1, b1] = [x, c, 0];
  else if (hh < 180) [r1, g1, b1] = [0, c, x];
  else if (hh < 240) [r1, g1, b1] = [0, x, c];
  else if (hh < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
};

const rgbToHsl = (r, g, b) => {
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case rr:
        h = 60 * (((gg - bb) / d) % 6);
        break;
      case gg:
        h = 60 * ((bb - rr) / d + 2);
        break;
      case bb:
        h = 60 * ((rr - gg) / d + 4);
        break;
      default:
        h = 0;
    }
  }
  if (h < 0) h += 360;
  return { h, s, l };
};

const parseHslString = (input) => {
  if (typeof input !== "string") return null;
  const m = input.trim().toLowerCase().match(/^hsla?\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)%\s*,\s*([+-]?\d+(?:\.\d+)?)%\s*(?:,\s*([0-9.]+)\s*)?\)$/i);
  if (!m) return null;
  const h = parseFloat(m[1]);
  const s = clamp(parseFloat(m[2]), 0, 100) / 100;
  const l = clamp(parseFloat(m[3]), 0, 100) / 100;
  return hslToRgb(h, s, l);
};

const parseColorString = (input) => {
  if (typeof input !== "string" || !input.trim()) return null;
  const v = input.trim();
  return hexToRgb(v) || parseRgbString(v) || parseHslString(v);
};

const formatColorForMode = (mode, rgb) => {
  const { r, g, b } = rgb;
  if (mode === "rgb") {
    return `rgb(${clamp(r, 0, 255)}, ${clamp(g, 0, 255)}, ${clamp(b, 0, 255)})`;
  }
  if (mode === "hsl") {
    const hsl = rgbToHsl(r, g, b);
    const h = Math.round(hsl.h);
    const s = Math.round(hsl.s * 100);
    const l = Math.round(hsl.l * 100);
    return `hsl(${h}, ${s}%, ${l}%)`;
  }
  return rgbToHex({ r, g, b });
};

const updateColorModeControls = () => {
  const mode = state.colorInputMode;
  const map = [
    { el: elements.colorModeHexBtn, mode: "hex" },
    { el: elements.colorModeRgbBtn, mode: "rgb" },
    { el: elements.colorModeHslBtn, mode: "hsl" },
  ];
  map.forEach(({ el, mode: m }) => {
    if (!el) return;
    const active = mode === m;
    el.classList.toggle("active", active);
    el.setAttribute("aria-checked", active ? "true" : "false");
  });
};

const syncColorInputsFromState = () => {
  const rgb = parseColorString(state.backgroundColor) || hexToRgb("#0f172a") || { r: 15, g: 23, b: 42 };
  if (elements.colorValueInput) {
    elements.colorValueInput.classList.remove("is-invalid");
    elements.colorValueInput.setCustomValidity("");
    elements.colorValueInput.value = formatColorForMode(state.colorInputMode, rgb);
  }
  if (elements.backgroundColorInput) {
    elements.backgroundColorInput.value = rgbToHex(rgb);
  }
};

const setColorInputMode = (mode) => {
  if (!mode) {
    return;
  }

  const rgb =
    parseColorString(state.backgroundColor) ||
    hexToRgb("#0f172a") || { r: 15, g: 23, b: 42 };

  // Update selected mode
  state.colorInputMode = mode;

  // Reflect active state in UI
  updateColorModeControls();

  // Normalize inputs and state to the selected format
  if (elements.colorValueInput) {
    elements.colorValueInput.classList.remove("is-invalid");
    elements.colorValueInput.setCustomValidity("");
    elements.colorValueInput.value = formatColorForMode(state.colorInputMode, rgb);
  }

  // Store background color string in the chosen representation
  state.backgroundColor = formatColorForMode(state.colorInputMode, rgb);

  // Keep the native color input in sync (always hex)
  if (elements.backgroundColorInput) {
    elements.backgroundColorInput.value = rgbToHex(rgb);
  }

  notifyVisualConfigChanged();
  // Trigger a render so users see immediate feedback
  scheduleRender();
};

const setBackgroundColorFromText = (text) => {
  if (!elements.colorValueInput) return false;
  const rgb = parseColorString(text);
  if (!rgb) {
    elements.colorValueInput.classList.add("is-invalid");
    elements.colorValueInput.setCustomValidity("Invalid color");
    return false;
  }
  elements.colorValueInput.classList.remove("is-invalid");
  elements.colorValueInput.setCustomValidity("");
  const cssValue = formatColorForMode(state.colorInputMode, rgb);
  state.backgroundColor = cssValue;
  if (elements.backgroundColorInput) {
    elements.backgroundColorInput.value = rgbToHex(rgb);
  }
  notifyVisualConfigChanged();
  scheduleRender();
  return true;
};

 
const ensureDesktopBackground = async (targetDisplayId) => {
  const candidate =
    state.sources.find(
      (source) =>
        source.type === "screen" &&
        source.displayId &&
        targetDisplayId &&
        source.displayId === targetDisplayId,
    ) ||
    state.sources.find((source) => source.type === "screen");

  if (!candidate) {
    setStatus(
      "No desktop sources available. Try refreshing the sources list.",
      "error",
      6000,
    );
    return null;
  }

  if (state.desktopImages.has(candidate.id)) {
    if (!state.backgroundDesktopId) {
      setDesktopBackgroundById(candidate.id);
    } else {
      updateDesktopGalleryControls();
    }
    return state.desktopImages.get(candidate.id).image;
  }

  try {
    const capture =
      typeof api.captureDesktopWallpaper === "function"
        ? await api.captureDesktopWallpaper({
            sourceId: candidate.id,
            displayId: candidate.displayId || null,
            name: candidate.name || "",
          })
        : await api.captureSource(candidate.id);
    const image = await loadImageFromDataUrl(capture.dataURL);
    addDesktopImageEntry(candidate.id, image, capture, {
      label: capture.name || candidate.name || "Desktop wallpaper",
      source: "captured",
      preferFront: true,
    });
    if (!state.backgroundDesktopId) {
      setDesktopBackgroundById(candidate.id);
    }
    return image;
  } catch (error) {
    console.error("Failed to capture desktop background", error);
    setStatus("Unable to capture desktop background.", "error", 6000);
    return null;
  }
};

const drawScene = async () => {
  if (!state.screenshotImage) {
    showPlaceholder(true);
    state.lastRenderDataUrl = null;
    return;
  }

  const img = state.screenshotImage;
  const baseWidth = img.naturalWidth || img.width;
  const baseHeight = img.naturalHeight || img.height;
  const padding = state.padding;
  const cornerRadius = 26;
  const shadowEnabled = state.withShadow;

  const shadowBlur = shadowEnabled ? Math.min(90, Math.max(24, padding * 0.65)) : 0;
  const shadowOffsetY = shadowEnabled ? Math.min(70, Math.round(padding * 0.55)) : 0;
  const shadowPadX = shadowEnabled ? shadowBlur : 0;
  const shadowPadYTop = shadowEnabled ? shadowBlur : 0;
  const shadowPadYBottom = shadowEnabled ? shadowBlur + shadowOffsetY : 0;

  const canvasWidth =
    baseWidth + padding * 2 + shadowPadX * 2;
  const canvasHeight =
    baseHeight + padding * 2 + shadowPadYTop + shadowPadYBottom;

  elements.previewCanvas.width = canvasWidth;
  elements.previewCanvas.height = canvasHeight;

   canvasContext.save();
   canvasContext.clearRect(0, 0, canvasWidth, canvasHeight);
   // Ensure best-possible resampling quality for any scaled images/backgrounds
   canvasContext.imageSmoothingEnabled = true;
   canvasContext.imageSmoothingQuality = "high";

  // Background treatment
  switch (state.backgroundMode) {
    case "transparent":
      canvasContext.clearRect(0, 0, canvasWidth, canvasHeight);
      break;
    case "color":
      canvasContext.fillStyle = state.backgroundColor;
      canvasContext.fillRect(0, 0, canvasWidth, canvasHeight);
      break;
    case "desktop": {
      const imageEntry =
        (state.backgroundDesktopId &&
          state.desktopImages.get(state.backgroundDesktopId)) ||
        null;
      if (!imageEntry) {
        await ensureDesktopBackground(
          state.selectedCapture?.displayId || null,
        );
        const refreshedEntry =
          state.backgroundDesktopId &&
          state.desktopImages.get(state.backgroundDesktopId);
        if (refreshedEntry) {
          drawCoverImage(canvasContext, refreshedEntry.image, canvasWidth, canvasHeight);
        } else {
          const gradient = canvasContext.createLinearGradient(
            0,
            0,
            canvasWidth,
            canvasHeight,
          );
          gradient.addColorStop(0, "#141932");
          gradient.addColorStop(1, "#090b1b");
          canvasContext.fillStyle = gradient;
          canvasContext.fillRect(0, 0, canvasWidth, canvasHeight);
        }
      } else {
        drawCoverImage(canvasContext, imageEntry.image, canvasWidth, canvasHeight);
      }
      break;
    }
    case "image":
      if (state.customImage) {
        drawCoverImage(canvasContext, state.customImage, canvasWidth, canvasHeight);
      } else {
        const gradient = canvasContext.createLinearGradient(
          0,
          0,
          canvasWidth,
          canvasHeight,
        );
        gradient.addColorStop(0, "#141932");
        gradient.addColorStop(1, "#090b1b");
        canvasContext.fillStyle = gradient;
        canvasContext.fillRect(0, 0, canvasWidth, canvasHeight);
      }
      break;
    default: {
      const gradient = canvasContext.createLinearGradient(
        0,
        0,
        canvasWidth,
        canvasHeight,
      );
      gradient.addColorStop(0, "#141932");
      gradient.addColorStop(1, "#090b1b");
      canvasContext.fillStyle = gradient;
      canvasContext.fillRect(0, 0, canvasWidth, canvasHeight);
      break;
    }
  }

  const drawX = padding + shadowPadX;
  const drawY = padding + shadowPadYTop;

  if (shadowEnabled) {
    canvasContext.save();
    canvasContext.fillStyle = "rgba(11, 15, 34, 0.01)";
    canvasContext.shadowColor = "rgba(8, 12, 32, 0.55)";
    canvasContext.shadowBlur = shadowBlur;
    canvasContext.shadowOffsetX = 0;
    canvasContext.shadowOffsetY = shadowOffsetY;
    getRoundedRectPath(
      canvasContext,
      drawX,
      drawY,
      baseWidth,
      baseHeight,
      cornerRadius,
    );
    canvasContext.fill();
    canvasContext.restore();
  }

  drawRoundedImage(canvasContext, img, drawX, drawY, baseWidth, baseHeight, cornerRadius);
  canvasContext.restore();

  const maxPreviewWidth = 980;
  const maxPreviewHeight = 560;
  const scale = Math.min(
    1,
    maxPreviewWidth / canvasWidth,
    maxPreviewHeight / canvasHeight,
  );

  elements.previewCanvas.style.width = `${Math.round(canvasWidth * scale)}px`;
  elements.previewCanvas.style.height = `${Math.round(canvasHeight * scale)}px`;
  showPlaceholder(false);

  state.lastRenderDataUrl = elements.previewCanvas.toDataURL("image/png");
};

const scheduleRender = () => {
  if (!state.screenshotImage) {
    showPlaceholder(true);
    return;
  }

  if (state.renderQueued) {
    return;
  }

  state.renderQueued = true;
  window.requestAnimationFrame(async () => {
    state.renderQueued = false;
    await drawScene();
    elements.saveButton.disabled = !state.lastRenderDataUrl;
  });
};

const applyCaptureResult = async (capture, options = {}) => {
  if (!capture?.dataURL) {
    throw new Error("Invalid capture payload.");
  }

  const image = await loadImageFromDataUrl(capture.dataURL);
  const sourceId =
    options.sourceId === undefined ? capture.id ?? null : options.sourceId;

  state.selectedSourceId = sourceId;
  if (recordingController?.setActiveSource) {
    recordingController.setActiveSource(sourceId);
  }
  state.selectedCapture = capture;
  state.screenshotImage = image;

  elements.saveButton.disabled = true;

  if (state.backgroundMode === "desktop") {
    ensureDesktopBackground(capture.displayId || null);
    ensureDefaultWallpapersLoaded();
  }

  renderSourceList();

  if (options.statusMessage) {
    setStatus(options.statusMessage, options.statusTone ?? "success");
  }

  scheduleRender();
};

const handleBackgroundModeChange = async (mode, options = {}) => {
  const { force = false } = options;
  const isSameMode = state.backgroundMode === mode;

  if (isSameMode && !force) {
    updateBackgroundFields();
    scheduleRender();
    return;
  }

  state.backgroundMode = mode;
  notifyVisualConfigChanged();
  updateSegmentControls();
  updateBackgroundFields();

  if (mode === "desktop") {
    setStatus("Loading desktop wallpaper...", "neutral", 0);
    scheduleRender();
    Promise.allSettled([
      ensureDesktopBackground(state.selectedCapture?.displayId || null),
      ensureDefaultWallpapersLoaded(),
    ]).then(() => {
      if (state.backgroundMode !== "desktop") {
        return;
      }
      updateBackgroundFields();
      scheduleRender();
      if (
        state.backgroundDesktopId &&
        state.desktopImages.has(state.backgroundDesktopId)
      ) {
        setStatus("Desktop wallpaper ready.", "success");
      }
    });
    return;
  }

  if (mode === "image") {
    if (!state.customImage) {
      setStatus("Upload a custom background to activate this mode.", "neutral");
    }
    renderCustomBackgroundGallery();
  } else if (mode === "transparent") {
    setStatus("Background set to transparent PNG.", "neutral");
  }

  scheduleRender();
};

const handleSourceSelection = async (sourceId) => {
  if (state.isCapturing || !sourceId) {
    return;
  }

  const selectedSource =
    state.sources.find((source) => source.id === sourceId) || null;
  const isScreenSource = selectedSource?.type === "screen";
  const statusLabel = isScreenSource ? "desktop wallpaper" : "window";
  const selectedSourceName = getReadableSourceName(selectedSource);

  state.isCapturing = true;
  if (elements.areaCaptureBtn) {
    elements.areaCaptureBtn.disabled = true;
  }
  togglePreviewLoading(true);
  setStatus(`Capturing ${statusLabel}...`, "neutral", 0);

  try {
    let capture = null;

    if (
      isScreenSource &&
      typeof api.captureDesktopWallpaper === "function"
    ) {
      try {
        capture = await api.captureDesktopWallpaper({
          sourceId,
          displayId: selectedSource?.displayId || null,
          name: selectedSourceName,
        });
      } catch (wallpaperError) {
        console.warn(
          "Wallpaper-only capture failed, falling back to direct screen capture",
          wallpaperError,
        );
      }
    }

    if (!capture) {
      capture = await api.captureSource(sourceId);
    }

    const captureName = getReadableSourceName(capture || selectedSource);
    const successMessage =
      isScreenSource && capture?.wallpaperOnly
        ? "Captured themed desktop background."
        : `Captured ${capture.width} x ${capture.height} from ${captureName}.`;

    await applyCaptureResult(capture, {
      sourceId,
      statusMessage: successMessage,
      statusTone: "success",
    });
  } catch (error) {
    console.error("Failed to capture source", error);
    setStatus("Unable to capture that source. Try again.", "error", 6000);
  } finally {
    togglePreviewLoading(false);
    state.isCapturing = false;
    if (elements.areaCaptureBtn) {
      elements.areaCaptureBtn.disabled = false;
    }
  }
};

const startAreaCapture = async () => {
  if (state.isCapturing) {
    return;
  }

  if (!api?.captureArea) {
    setStatus(
      "Area capture is unavailable on this platform.",
      "error",
      6000,
    );
    return;
  }

  state.isCapturing = true;
  togglePreviewLoading(true);
  setStatus("Select an area to capture...", "neutral", 0);
  if (elements.areaCaptureBtn) {
    elements.areaCaptureBtn.disabled = true;
  }

  try {
    const result = await api.captureArea();
    if (!result || result.canceled) {
      setStatus("Capture cancelled.", "neutral");
      return;
    }

    const capture = result.capture;
    if (!capture?.dataURL) {
      throw new Error("Capture result missing image data.");
    }

    const statusMessage =
      capture.type === "screen"
        ? "Captured full display screenshot."
        : `Captured ${capture.width} x ${capture.height} selection.`;

    await applyCaptureResult(capture, {
      sourceId: null,
      statusMessage,
      statusTone: "success",
    });
  } catch (error) {
    console.error("Area capture failed", error);
    setStatus("Area capture failed. Try again.", "error", 6000);
  } finally {
    togglePreviewLoading(false);
    state.isCapturing = false;
    if (elements.areaCaptureBtn) {
      elements.areaCaptureBtn.disabled = false;
    }
  }
};

const handleSave = async () => {
  if (!state.lastRenderDataUrl) {
    setStatus("Nothing to export yet. Capture a window first.", "error", 5000);
    return;
  }

  elements.saveButton.disabled = true;
  setStatus("Preparing export...", "neutral", 0);

  try {
    const captureName = getReadableSourceName(state.selectedCapture);
    const sanitizedName = captureName.replace(/[\\/:*?"<>|]/g, "").trim();
    const defaultPath = sanitizedName ? `${sanitizedName}.png` : undefined;

    const result = await api.saveImage({
      dataURL: state.lastRenderDataUrl,
      defaultPath,
    });

    if (result.canceled) {
      setStatus("Export cancelled.", "neutral");
    } else {
      // Attempt to copy the exported image to the user's clipboard
      let copied = false;
      try {
        const copyResult = await api.copyImageToClipboard({
          dataURL: state.lastRenderDataUrl,
        });
        copied = Boolean(copyResult && copyResult.success);
      } catch (clipboardError) {
        // Non-fatal; saving succeeded even if clipboard copy fails
        console.warn("Copy to clipboard failed after save", clipboardError);
      }

      const suffix = copied ? " and copied to clipboard." : ".";
      setStatus(`Saved to ${result.filePath}${suffix}`, "success", 6000);
    }
  } catch (error) {
    console.error("Failed to save image", error);
    setStatus("Export failed. Please try again.", "error", 6000);
  } finally {
    elements.saveButton.disabled = false;
  }
};

const handleCustomImageSelection = async (event) => {
  const [file] = event.target.files || [];
  if (!file) {
    return;
  }

  const resetInput = () => {
    if (event.target) {
      event.target.value = "";
    }
  };

  if (!isSupportedImageFile(file)) {
    setStatus("Please choose an image file.", "error", 5000);
    resetInput();
    return;
  }

  let persistFailed = false;
  let savedForReuse = false;

  try {
    const dataUrl = await readFileAsDataUrl(file);
    const image = await loadImageFromDataUrl(dataUrl);
    let savedEntry = null;

    if (typeof api.saveCustomBackground === "function") {
      try {
        savedEntry = await api.saveCustomBackground({
          dataURL: dataUrl,
          name: file.name,
        });
      } catch (persistError) {
        persistFailed = true;
        console.warn("Failed to persist custom background", persistError);
        setStatus(
          "Loaded background, but saving for later failed.",
          "error",
          6000,
        );
      }
    }

    if (savedEntry) {
      const preparedEntry = {
        ...savedEntry,
        dataURL: savedEntry.dataURL || dataUrl,
        image,
      };
      upsertCustomBackgroundEntry(preparedEntry);
      state.customImage = preparedEntry.image;
      state.customImageName = preparedEntry.name || file.name;
      setActiveCustomBackground(preparedEntry.id);
      savedForReuse = true;
    } else {
      state.customImage = image;
      state.customImageName = file.name;
      state.activeCustomBackgroundId = null;
      renderCustomBackgroundGallery();
    }

    elements.imageNameLabel.textContent =
      state.customImageName || "Custom image";
    notifyVisualConfigChanged();

    if (state.backgroundMode !== "image") {
      await handleBackgroundModeChange("image");
    } else {
      scheduleRender();
    }

    if (!persistFailed) {
      setStatus(
        savedForReuse
          ? "Custom background saved for reuse."
          : "Custom background ready.",
        savedForReuse ? "success" : "neutral",
      );
    }
  } catch (error) {
    console.error("Failed to load custom background image", error);
    setStatus("Could not load that image.", "error", 5000);
  } finally {
    resetInput();
  }
};

const handleDesktopImportSelection = async (event) => {
  const input = event.target;
  const files = Array.from(input?.files || []);
  if (input) {
    input.value = "";
  }

  if (!files.length) {
    return;
  }

  const validFiles = files.filter(isSupportedImageFile);
  const skippedCount = files.length - validFiles.length;

  if (!validFiles.length) {
    setStatus("Only image files can be imported as backgrounds.", "error", 5000);
    return;
  }

  const baseStamp = Date.now().toString(36);
  let importedCount = 0;
  let lastImportedId = null;
  const failedFiles = [];

  for (const [index, file] of validFiles.entries()) {
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const image = await loadImageFromDataUrl(dataUrl);
      const id = `imported-${baseStamp}-${index.toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      const capture = {
        id,
        name: file.name,
        dataURL: dataUrl,
        source: "imported",
      };
      addDesktopImageEntry(id, image, capture, {
        label: file.name || "Imported background",
        source: "imported",
        preferFront: true,
      });
      lastImportedId = id;
      importedCount += 1;
    } catch (error) {
      failedFiles.push(file.name || "Unknown file");
      console.error("Failed to import desktop background", file?.name, error);
    }
  }

  if (!importedCount) {
    setStatus(
      "Unable to import the selected backgrounds. Please try different images.",
      "error",
      6000,
    );
    return;
  }

  if (lastImportedId) {
    setDesktopBackgroundById(lastImportedId);
  }

  if (state.backgroundMode !== "desktop") {
    await handleBackgroundModeChange("desktop");
  } else {
    scheduleRender();
  }

  let message =
    importedCount === 1
      ? "Imported 1 desktop background."
      : `Imported ${importedCount} desktop backgrounds.`;

  if (skippedCount > 0) {
    message += ` Skipped ${skippedCount} non-image file${skippedCount === 1 ? "" : "s"}.`;
  }

  if (failedFiles.length > 0) {
    message += ` Failed to import ${failedFiles.length} file${failedFiles.length === 1 ? "" : "s"}.`;
    setStatus(message, "error", 6000);
  } else {
    setStatus(message, "success");
  }
};

const handleImportImage = async () => {
  if (state.isCapturing) {
    return;
  }

  state.isCapturing = true;
  togglePreviewLoading(true);
  setStatus("Importing image...", "neutral", 0);
  if (elements.areaCaptureBtn) {
    elements.areaCaptureBtn.disabled = true;
  }
  if (elements.importImageBtn) {
    elements.importImageBtn.disabled = true;
  }

  const fallbackPick = () =>
    new Promise((resolve, reject) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "image/png,image/jpeg,image/webp,image/bmp,image/jfif";
      input.onchange = async () => {
        const [file] = Array.from(input.files || []);
        if (!file) {
          resolve({ canceled: true });
          return;
        }
        try {
          const dataURL = await readFileAsDataUrl(file);
          const image = await loadImageFromDataUrl(dataURL);
          resolve({
            canceled: false,
            name: file.name.replace(/\.[^.]+$/, ""),
            width: image.naturalWidth || image.width,
            height: image.naturalHeight || image.height,
            dataURL,
          });
        } catch (err) {
          reject(err);
        }
      };
      input.click();
    });

  try {
    const result =
      typeof api.openImage === "function" ? await api.openImage() : await fallbackPick();

    if (!result || result.canceled) {
      setStatus("Import cancelled.", "neutral");
      return;
    }
    if (!result.dataURL) {
      throw new Error("No image data returned.");
    }

    const capture = {
      id: `import:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      name: result.name || "Imported Image",
      type: "import",
      displayId: null,
      width: result.width || 0,
      height: result.height || 0,
      dataURL: result.dataURL,
      appIcon: null,
    };

    await applyCaptureResult(capture, {
      sourceId: null,
      statusMessage: "Imported image ready.",
      statusTone: "success",
    });
  } catch (error) {
    console.error("Failed to import image", error);
    setStatus("Unable to import that image. Try a different file.", "error", 6000);
  } finally {
    togglePreviewLoading(false);
    state.isCapturing = false;
    if (elements.areaCaptureBtn) {
      elements.areaCaptureBtn.disabled = false;
    }
    if (elements.importImageBtn) {
      elements.importImageBtn.disabled = false;
    }
  }
};

const handleWindowFocus = () => {
  loadSources({ silent: true });
};

const handleVisibilityChange = () => {
  if (!document.hidden) {
    loadSources({ silent: true });
  }
};

const bindEvents = () => {
  elements.areaCaptureBtn?.addEventListener("click", () => {
    startAreaCapture();
  });

  elements.importImageBtn?.addEventListener("click", () => {
    handleImportImage();
  });

  elements.refreshButton?.addEventListener("click", () => {
    loadSources();
  });

  elements.sourceFilterInput?.addEventListener("input", (event) => {
    state.filterValue = event.target.value || "";
    renderSourceList();
  });

  elements.sourceList?.addEventListener("click", (event) => {
    const card = event.target.closest(".source-card");
    if (card?.dataset?.id) {
      handleSourceSelection(card.dataset.id);
    }
  });

  elements.segmentButtons.forEach((button) => {
    button.addEventListener("click", () => {
      handleBackgroundModeChange(button.dataset.mode);
    });
  });

  elements.backgroundColorInput?.addEventListener("input", (event) => {
    state.backgroundColor = event.target.value;
    notifyVisualConfigChanged();
    syncColorInputsFromState();
    scheduleRender();
  });

  elements.colorModeHexBtn?.addEventListener("click", () => setColorInputMode("hex"));
  elements.colorModeRgbBtn?.addEventListener("click", () => setColorInputMode("rgb"));
  elements.colorModeHslBtn?.addEventListener("click", () => setColorInputMode("hsl"));

  let colorInputDebounce = 0;
  elements.colorValueInput?.addEventListener("input", (e) => {
    const value = e.target.value;
    clearTimeout(colorInputDebounce);
    colorInputDebounce = window.setTimeout(() => {
      setBackgroundColorFromText(value);
    }, 120);
  });

  elements.paddingSlider?.addEventListener("input", (event) => {
    const value = Number.parseInt(event.target.value, 10);
    state.padding = value;
    elements.paddingValueLabel.textContent = `${value} px`;
    notifyVisualConfigChanged();
    scheduleRender();
  });

  elements.shadowToggle?.addEventListener("change", (event) => {
    state.withShadow = Boolean(event.target.checked);
    syncShadowSwitch();
    notifyVisualConfigChanged();
    scheduleRender();
  });

  elements.saveButton?.addEventListener("click", () => {
    handleSave();
  });

  elements.chooseImageBtn?.addEventListener("click", () => {
    elements.backgroundImageInput?.click();
  });

  elements.backgroundImageInput?.addEventListener(
    "change",
    handleCustomImageSelection,
  );

  elements.desktopImportBtn?.addEventListener("click", () => {
    elements.desktopImportInput?.click();
  });

  elements.desktopImportInput?.addEventListener(
    "change",
    handleDesktopImportSelection,
  );

  elements.desktopPrevBtn?.addEventListener("click", () => {
    cycleDesktopBackground(-1);
  });

  elements.desktopNextBtn?.addEventListener("click", () => {
    cycleDesktopBackground(1);
  });

  elements.savedBackgroundsList?.addEventListener("click", (event) => {
    const button = event.target.closest(".custom-bg-thumb");
    if (button?.dataset?.id) {
      applySavedCustomBackground(button.dataset.id);
    }
  });

  window.addEventListener("focus", handleWindowFocus);
  document.addEventListener("visibilitychange", handleVisibilityChange);
};

const loadSources = async (options = {}) => {
  const { silent = false } = options;

  if (state.isLoadingSources) {
    return;
  }

  state.isLoadingSources = true;
  if (elements.refreshButton) {
    elements.refreshButton.disabled = true;
    elements.refreshButton.setAttribute("aria-busy", "true");
  }

  if (!silent) {
    setStatus("Scanning for windows...", "neutral", 0);
  }

  try {
    const sources = await api.listSources();
    state.sources = sources;
    renderSourceList();
    if (recordingController?.syncSources) {
      recordingController.syncSources(sources);
    }
    if (!silent) {
      setStatus(`Found ${sources.length} capture sources.`);
    }
  } catch (error) {
    console.error("Failed to load sources", error);
    setStatus("Unable to list windows. Try refreshing.", "error", 5000);
  } finally {
    state.isLoadingSources = false;
    if (elements.refreshButton) {
      elements.refreshButton.disabled = false;
      elements.refreshButton.removeAttribute("aria-busy");
    }
  }
};

const init = () => {
  if (!api) {
    setStatus(
      "Renderer bridge unavailable. Please restart the application.",
      "error",
      0,
    );
    return;
  }

  if (elements.paddingSlider) {
    const sliderValue = Number.parseInt(elements.paddingSlider.value, 10);
    if (!Number.isNaN(sliderValue)) {
      state.padding = sliderValue;
      elements.paddingValueLabel.textContent = `${sliderValue} px`;
    }
  }

  if (elements.backgroundColorInput?.value) {
    state.backgroundColor = elements.backgroundColorInput.value;
  }

  updateColorModeControls();
  syncColorInputsFromState();

  if (elements.shadowToggle) {
    state.withShadow = Boolean(elements.shadowToggle.checked);
  }

  syncShadowSwitch();
  updateBackgroundFields();
  updateSegmentControls();
  bindEvents();
  recordingController = initializeRecordingController({
    api,
    previewCanvas: elements.previewCanvas,
    previewStage: elements.previewStage,
    onStatus: setStatus,
  });
  loadSources();
  loadCustomBackgrounds();
};

document.addEventListener("DOMContentLoaded", init);
