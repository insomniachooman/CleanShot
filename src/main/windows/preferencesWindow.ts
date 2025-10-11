
import { BrowserWindow } from 'electron';
import * as path from 'node:path';

let prefWin: BrowserWindow | null = null;

export function createPreferencesWindow() {
  if (prefWin && !prefWin.isDestroyed()) {
    prefWin.show();
    prefWin.focus();
    return prefWin;
  }
  prefWin = new BrowserWindow({
    width: 880,
    height: 620,
    title: 'Preferences',
    resizable: false,
    show: true,
    frame: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../../preload/index.js'),
      sandbox: true
    }
  });

  if (process.env.ELECTRON_START_URL) {
    prefWin.loadURL(`${process.env.ELECTRON_START_URL}/preferences/index.html`);
  } else {
    prefWin.loadFile(path.join(__dirname, '../../renderer/preferences/index.html'));
  }

  prefWin.on('closed', () => {
    prefWin = null;
  });

  return prefWin;
}
    