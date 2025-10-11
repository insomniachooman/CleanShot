
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, nativeImage, screen, shell, Tray } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import Store from 'electron-store';
import { registerIpcHandlers } from './ipc';
import { createOverlayWindow } from './windows/overlayWindow';
import { createPinWindow } from './windows/pinWindow';
import { createPreferencesWindow } from './windows/preferencesWindow';

function resolveAssetPath(...segments: string[]): string {
  const prodPath = path.join(process.resourcesPath, ...segments);
  if (app.isPackaged && fs.existsSync(prodPath)) return prodPath;

  const devPath = path.join(process.cwd(), ...segments);
  if (fs.existsSync(devPath)) return devPath;

  const distAdjacent = path.join(__dirname, '../../', ...segments);
  return distAdjacent;
}

const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_START_URL;

if (isDev) {
  try {
    const pathMod = require('node:path');
    const watchPaths = [
      pathMod.join(__dirname, '..'),
      pathMod.join(process.cwd(), 'src')
    ];
    require('electron-reload')(watchPaths, {
      awaitWriteFinish: true,
      forceHardReset: true,
      hardResetMethod: 'exit'
    });
  } catch (e) {
    console.warn('electron-reload not installed:', e);
  }
}

let tray: Tray | null = null;
let trayMenu: Menu | null = null;
const store = new Store({
  name: 'settings',
  defaults: {
    outputFolder: path.join(app.getPath('pictures'), 'CleanShotX'),
    autoCopyToClipboard: true,
    defaultFormat: 'png',
    defaultQuality: 0.92,
    includeCursorByDefault: false,
    hotkeys: {
      newRegion: 'Control+Shift+1',
      windowCapture: 'Control+Shift+2',
      displayCapture: 'Control+Shift+3',
      scrollingCapture: 'Control+Shift+4',
      pinClickThrough: 'Control+Shift+T',
      hideDesktopIcons: 'Control+Shift+H',
      repeatLast: 'Control+Shift+R'
    }
  }
});

function ensureOutputFolder() {
  const folder = store.get('outputFolder') as string;
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true });
  }
}

function registerGlobalShortcuts() {
  const hotkeys = (store.get('hotkeys') as any) || {};
  globalShortcut.register(hotkeys.newRegion || 'Control+Shift+1', () => startRegionCapture());
  globalShortcut.register(hotkeys.windowCapture || 'Control+Shift+2', () => startWindowCapture());
  globalShortcut.register(hotkeys.displayCapture || 'Control+Shift+3', () => startDisplayCapture());
  globalShortcut.register(hotkeys.scrollingCapture || 'Control+Shift+4', () => startScrollingCapture());
}

async function startRegionCapture() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  createOverlayWindow({ displayId: String(display.id), mode: 'region' });
}

async function startWindowCapture() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  createOverlayWindow({ displayId: String(display.id), mode: 'window' });
}

async function startDisplayCapture() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  createOverlayWindow({ displayId: String(display.id), mode: 'display' });
}

async function startScrollingCapture() {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  createOverlayWindow({ displayId: String(display.id), mode: 'scrolling' });
}

function createTray() {
  const iconCandidates: string[] = [
    resolveAssetPath('assets', 'trayTemplate.png'),
    resolveAssetPath('assets', 'trayTemplate.svg')
  ];
  const resolvedIcon = iconCandidates.find(p => fs.existsSync(p)) ?? iconCandidates[0];
  const image = fs.existsSync(resolvedIcon) ? nativeImage.createFromPath(resolvedIcon) : nativeImage.createEmpty();

  tray = new Tray(image);
  tray.setToolTip('CleanShotX for Windows');

  trayMenu = Menu.buildFromTemplate([
    { label: 'New Capture', accelerator: 'Control+Shift+1', click: () => startRegionCapture() },
    { label: 'Capture Window', accelerator: 'Control+Shift+2', click: () => startWindowCapture() },
    { label: 'Capture Screen', accelerator: 'Control+Shift+3', click: () => startDisplayCapture() },
    { label: 'Scrolling Capture', accelerator: 'Control+Shift+4', click: () => startScrollingCapture() },
    { type: 'separator' },
    { label: 'Pin from Clipboard', click: () => createPinWindow({ fromClipboard: true }) },
    { label: 'Preferences', click: () => createPreferencesWindow() },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' }
  ]);

  tray.setContextMenu(trayMenu);

  tray.on('click', () => {
    if (tray && trayMenu) {
      tray.popUpContextMenu(trayMenu);
    }
  });

  tray.setIgnoreDoubleClickEvents(false);
  tray.on('double-click', () => {
    createPreferencesWindow();
  });
}

app.setName('CleanShotX for Windows');

app.whenReady().then(() => {
  ensureOutputFolder();
  createTray();
  registerGlobalShortcuts();
  registerIpcHandlers(store);

  // Optional hidden window to own app lifetime
  const hidden = new BrowserWindow({ show: false });
  hidden.loadURL('about:blank');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createPreferencesWindow();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught exception', err);
});
    