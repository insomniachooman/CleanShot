
import { BrowserWindow, screen } from 'electron';
import * as path from 'node:path';

type OverlayMode = 'region' | 'window' | 'display' | 'scrolling';

interface OverlayOptions {
  displayId: string;
  mode: OverlayMode;
}

export function createOverlayWindow(opts: OverlayOptions) {
  const display = screen.getAllDisplays().find(d => String(d.id) === String(opts.displayId)) || screen.getPrimaryDisplay();
  const bounds = display.bounds;

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    resizable: false,
    show: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreenable: false,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../../preload/index.js'),
      sandbox: true
    }
  });

  if (process.env.ELECTRON_START_URL) {
    win.loadURL(`${process.env.ELECTRON_START_URL}/overlay/index.html?mode=${opts.mode}&displayId=${opts.displayId}`);
  } else {
    win.loadFile(path.join(__dirname, '../../renderer/overlay/index.html'), {
      query: { mode: opts.mode, displayId: opts.displayId }
    });
  }

  win.setAlwaysOnTop(true, 'screen-saver');
  return win;
}
    