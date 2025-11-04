"use strict";

const path = require("path");
const { execFile } = require("child_process");
const { BrowserWindow, ipcMain, screen } = require("electron");
const { clamp } = require("./utils/math");
const { parseSourceId } = require("./utils/ids");

const isWindows = process.platform === "win32";

const pointInRect = (point, rect) => {
  if (!point || !rect) {
    return false;
  }
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
};

const computeVirtualBounds = () => {
  const displays = screen.getAllDisplays();
  if (!displays.length) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }
  const minX = Math.min(...displays.map((display) => display.bounds.x));
  const minY = Math.min(...displays.map((display) => display.bounds.y));
  const maxRight = Math.max(
    ...displays.map((display) => display.bounds.x + display.bounds.width),
  );
  const maxBottom = Math.max(
    ...displays.map((display) => display.bounds.y + display.bounds.height),
  );
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxRight - minX),
    height: Math.max(1, maxBottom - minY),
  };
};

const getDisplayGeometries = () => {
  const displays = screen.getAllDisplays();
  return displays.map((display) => {
    const scaleFactor = display.scaleFactor || 1;
    const boundsDip = {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
    };
    const physical = {
      x: Math.round(boundsDip.x * scaleFactor),
      y: Math.round(boundsDip.y * scaleFactor),
      width: Math.round(boundsDip.width * scaleFactor),
      height: Math.round(boundsDip.height * scaleFactor),
    };
    return {
      id: String(display.id),
      scaleFactor,
      boundsDip,
      boundsPhysical: physical,
    };
  });
};

const locateDisplayByDipPoint = (geometries, point) => {
  if (!Array.isArray(geometries) || !point) {
    return null;
  }
  const direct = geometries.find((geometry) =>
    pointInRect(point, geometry.boundsDip),
  );
  if (direct) {
    return direct;
  }
  const nearest = screen.getDisplayNearestPoint({
    x: Math.round(point.x),
    y: Math.round(point.y),
  });
  if (!nearest) {
    return null;
  }
  return (
    geometries.find((geometry) => geometry.id === String(nearest.id)) || null
  );
};

const locateDisplayByPhysicalPoint = (geometries, point) => {
  if (!Array.isArray(geometries) || !point) {
    return null;
  }
  const direct = geometries.find((geometry) =>
    pointInRect(point, geometry.boundsPhysical),
  );
  if (direct) {
    return direct;
  }
  return locateDisplayByDipPoint(geometries, {
    x: point.x,
    y: point.y,
  });
};

const convertPhysicalRectToDip = (rect, geometry) => {
  if (!rect || !geometry) {
    return null;
  }
  const { boundsDip, boundsPhysical, scaleFactor } = geometry;
  const offsetX = rect.x - boundsPhysical.x;
  const offsetY = rect.y - boundsPhysical.y;
  return {
    x: boundsDip.x + offsetX / scaleFactor,
    y: boundsDip.y + offsetY / scaleFactor,
    width: rect.width / scaleFactor,
    height: rect.height / scaleFactor,
  };
};

const queryWindowClientBounds = async (handleValue) => {
  if (!isWindows) {
    return null;
  }
  const sanitizedHandle = String(handleValue || "")
    .trim()
    .replace(/[^0-9]/g, "");
  if (!sanitizedHandle) {
    return null;
  }

  const script = String.raw`
Add-Type -Namespace Native -Name User32 -MemberDefinition @"
using System;
using System.Runtime.InteropServices;

public static class User32 {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINT {
    public int X;
    public int Y;
  }

  [DllImport("user32.dll")]
  public static extern bool GetClientRect(IntPtr hWnd, out RECT lpRect);

  [DllImport("user32.dll")]
  public static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);
}
"@

$handle = [System.IntPtr]::new([System.UInt64]::Parse("${sanitizedHandle}"))
$rect = New-Object Native.User32+RECT
if (-not [Native.User32]::GetClientRect($handle, [ref]$rect)) { exit 1 }
$origin = New-Object Native.User32+POINT
$origin.X = 0
$origin.Y = 0
if (-not [Native.User32]::ClientToScreen($handle, [ref]$origin)) { exit 2 }
$width = $rect.Right - $rect.Left
$height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0) { exit 3 }
Write-Output "$($origin.X),$($origin.Y),$width,$height"
`;

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NoLogo", "-Command", script],
      { windowsHide: true },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        const raw = String(stdout || "").trim();
        if (!raw) {
          resolve(null);
          return;
        }
        const parts = raw.split(",").map((part) => Number(part.trim()));
        if (parts.length !== 4) {
          resolve(null);
          return;
        }
        const [x, y, width, height] = parts;
        if (
          !Number.isFinite(x) ||
          !Number.isFinite(y) ||
          !Number.isFinite(width) ||
          !Number.isFinite(height)
        ) {
          resolve(null);
          return;
        }
        resolve({
          x: x,
          y: y,
          width: Math.max(1, width),
          height: Math.max(1, height),
        });
      },
    );
  });
};

const mapPointerToFrame = (session, payload) => {
  if (!session || !payload || !session.captureBounds || !session.frameSize) {
    return null;
  }
  const geometry = locateDisplayByDipPoint(
    session.displayGeometries,
    { x: payload.x, y: payload.y },
  );
  if (!geometry) {
    return { inside: false };
  }

  const relativeDipX = payload.x - geometry.boundsDip.x;
  const relativeDipY = payload.y - geometry.boundsDip.y;
  const physicalX =
    geometry.boundsPhysical.x +
    Math.round(relativeDipX * geometry.scaleFactor);
  const physicalY =
    geometry.boundsPhysical.y +
    Math.round(relativeDipY * geometry.scaleFactor);

  const localX = physicalX - session.captureBounds.physical.x;
  const localY = physicalY - session.captureBounds.physical.y;
  if (
    localX < 0 ||
    localY < 0 ||
    localX > session.captureBounds.physical.width ||
    localY > session.captureBounds.physical.height
  ) {
    return { inside: false };
  }

  const scaleX =
    session.captureBounds.physical.width > 0
      ? session.frameSize.width / session.captureBounds.physical.width
      : 1;
  const scaleY =
    session.captureBounds.physical.height > 0
      ? session.frameSize.height / session.captureBounds.physical.height
      : 1;

  return {
    inside: true,
    x: clamp(Math.round(localX * scaleX), 0, session.frameSize.width),
    y: clamp(Math.round(localY * scaleY), 0, session.frameSize.height),
  };
};

const createCursorOverlayManager = (options = {}) => {
  let overlayWindow = null;
  let overlayReady = false;
  let session = null;
  let boundsRefreshTimer = null;

  const pointerEmitter =
    typeof options.onPointer === "function" ? options.onPointer : () => {};

  const destroyOverlay = () => {
    if (overlayWindow && !overlayWindow.isDestroyed?.()) {
      overlayWindow.close();
    }
    overlayWindow = null;
    overlayReady = false;
  };

  const ensureOverlayWindow = () => {
    if (overlayWindow && !overlayWindow.isDestroyed?.()) {
      return overlayWindow;
    }
    const overlay = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      fullscreenable: false,
      enableLargerThanScreen: true,
      hasShadow: false,
      backgroundColor: "#00000000",
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "../preload/cursor-overlay-preload.js"),
      },
    });

    overlay.setAlwaysOnTop(true, "screen-saver");
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    overlay.on("closed", () => {
      overlayWindow = null;
      overlayReady = false;
    });

    overlay.webContents.once("did-finish-load", () => {
      overlayReady = true;
      overlay.webContents.send("cursor-overlay:ready");
    });

    overlay
      .loadFile(path.join(__dirname, "../renderer/overlays/cursor-overlay.html"))
      .catch((error) => {
        console.error("Failed to load cursor overlay window", error);
      });

    overlayWindow = overlay;
    return overlay;
  };

  const waitForOverlayReady = async () => {
    const overlay = ensureOverlayWindow();
    if (overlayReady) {
      return;
    }
    await new Promise((resolve) => {
      const handler = () => {
        overlayReady = true;
        resolve();
      };
      overlay.webContents.once("did-finish-load", handler);
    });
  };

  const resolveDisplayCaptureBounds = (target) => {
    const geometries = getDisplayGeometries();
    if (!geometries.length) {
      return null;
    }
    let geometry = null;
    if (target.displayId) {
      geometry = geometries.find(
        (entry) => entry.id === String(target.displayId),
      );
    }
    if (!geometry && target.sourceId) {
      const parsed = parseSourceId(target.sourceId);
      if (parsed?.type === "screen") {
        geometry =
          geometries.find((entry) => entry.id === String(parsed.display)) ||
          geometries.find((entry) => entry.id === String(parsed.handle)) ||
          null;
      }
    }
    geometry = geometry || geometries[0];
    if (!geometry) {
      return null;
    }
    return {
      dip: {
        x: geometry.boundsDip.x,
        y: geometry.boundsDip.y,
        width: geometry.boundsDip.width,
        height: geometry.boundsDip.height,
      },
      physical: {
        x: geometry.boundsPhysical.x,
        y: geometry.boundsPhysical.y,
        width: geometry.boundsPhysical.width,
        height: geometry.boundsPhysical.height,
      },
      displayId: geometry.id,
    };
  };

  const resolveWindowCaptureBounds = async (target) => {
    if (!target.sourceId) {
      return null;
    }
    const parsed = parseSourceId(target.sourceId);
    if (!parsed?.handle) {
      return null;
    }
    const clientRect = await queryWindowClientBounds(parsed.handle);
    if (!clientRect) {
      return null;
    }
    const geometries = getDisplayGeometries();
    if (!geometries.length) {
      return null;
    }
    const centerPoint = {
      x: clientRect.x + Math.round(clientRect.width / 2),
      y: clientRect.y + Math.round(clientRect.height / 2),
    };
    const geometry = locateDisplayByPhysicalPoint(geometries, centerPoint);
    if (!geometry) {
      return null;
    }
    const dipRect = convertPhysicalRectToDip(clientRect, geometry);
    return {
      dip: {
        x: dipRect ? dipRect.x : clientRect.x / geometry.scaleFactor,
        y: dipRect ? dipRect.y : clientRect.y / geometry.scaleFactor,
        width: dipRect ? dipRect.width : clientRect.width / geometry.scaleFactor,
        height: dipRect
          ? dipRect.height
          : clientRect.height / geometry.scaleFactor,
      },
      physical: clientRect,
      displayId: geometry.id,
    };
  };

  const resolveCaptureBounds = async (target) => {
    if (!target || !target.sourceType) {
      return null;
    }
    if (target.sourceType === "screen") {
      return resolveDisplayCaptureBounds(target);
    }
    if (target.sourceType === "window") {
      return resolveWindowCaptureBounds(target);
    }
    return null;
  };

  const teardownBoundsWatcher = () => {
    if (boundsRefreshTimer) {
      clearInterval(boundsRefreshTimer);
    }
    boundsRefreshTimer = null;
  };

  const setupBoundsWatcher = (target) => {
    teardownBoundsWatcher();
    if (!target || target.sourceType !== "window" || !isWindows) {
      return;
    }
    boundsRefreshTimer = setInterval(async () => {
      if (!session || session.sourceType !== "window") {
        return;
      }
      const nextBounds = await resolveWindowCaptureBounds(session);
      if (nextBounds) {
        session.captureBounds = nextBounds;
      }
    }, 800);
  };

  const updateSession = async (target) => {
    if (!target) {
      return { success: false, reason: "invalid-target" };
    }
    const frameWidth = Math.max(1, Number(target.frameWidth) || 0);
    const frameHeight = Math.max(1, Number(target.frameHeight) || 0);
    const normalized = {
      sourceId: target.sourceId || null,
      sourceType: target.sourceType || null,
      displayId: target.displayId || null,
      frameSize: { width: frameWidth, height: frameHeight },
    };
    const captureBounds = await resolveCaptureBounds(normalized);
    if (!captureBounds) {
      return { success: false, reason: "capture-bounds-unavailable" };
    }
    session = {
      ...normalized,
      captureBounds,
      displayGeometries: getDisplayGeometries(),
    };
    setupBoundsWatcher(normalized);
    return { success: true };
  };

  const start = async (target) => {
    await waitForOverlayReady();
    const overlay = ensureOverlayWindow();
    const result = await updateSession(target);
    if (!result.success) {
      return result;
    }
    const bounds = computeVirtualBounds();
    overlay.setBounds(bounds);
    overlay.showInactive();
    overlay.setIgnoreMouseEvents(true, { forward: true });
    overlay.webContents.send("cursor-overlay:session", { active: true });
    return { success: true };
  };

  const update = async (target) => {
    if (!session) {
      return { success: false, reason: "inactive" };
    }
    const result = await updateSession({
      ...session,
      ...target,
    });
    if (result.success && overlayWindow && overlayReady) {
      overlayWindow.webContents.send("cursor-overlay:session", { active: true });
    }
    return result;
  };

  const stop = () => {
    teardownBoundsWatcher();
    session = null;
    if (overlayWindow && !overlayWindow.isDestroyed?.()) {
      try {
        overlayWindow.webContents.send("cursor-overlay:session", {
          active: false,
        });
      } catch (_err) {
        // Ignore failures when overlay content is not ready.
      }
      overlayWindow.hide();
      overlayWindow.setIgnoreMouseEvents(false);
    }
  };

  const handlePointerEvent = (_event, payload) => {
    if (!payload || !session) {
      return;
    }
    const mapped = mapPointerToFrame(session, payload);
    pointerEmitter({
      type: payload.type,
      button: payload.button,
      buttons: payload.buttons,
      timestamp: Date.now(),
      inside: Boolean(mapped?.inside),
      x: mapped?.inside ? mapped.x : null,
      y: mapped?.inside ? mapped.y : null,
    });
  };

  ipcMain.on("cursor-overlay:pointer-event", handlePointerEvent);

  return {
    start,
    update,
    stop,
    destroy: () => {
      stop();
      ipcMain.removeListener(
        "cursor-overlay:pointer-event",
        handlePointerEvent,
      );
      destroyOverlay();
    },
  };
};

module.exports = {
  createCursorOverlayManager,
};
