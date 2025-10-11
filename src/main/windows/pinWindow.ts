
import { BrowserWindow, app, nativeImage } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';

let counter = 0;

export async function createPinWindow(opts: { imagePath?: string; fromClipboard?: boolean }): Promise<string> {
  const id = `pin-${++counter}`;
  const win = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    resizable: true,
    show: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    focusable: true,
    hasShadow: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../../preload/index.js'),
      sandbox: true
    }
  });

  const imagePath = opts.imagePath && fs.existsSync(opts.imagePath) ? opts.imagePath : undefined;
  const src = imagePath ? `file://${imagePath}` : '';
  if (process.env.ELECTRON_START_URL) {
    win.loadURL(`${process.env.ELECTRON_START_URL}/pin/index.html?src=${encodeURIComponent(src)}`);
  } else {
    win.loadFile(path.join(__dirname, '../../renderer/pin/index.html'), {
      query: { src }
    });
  }

  win.setAlwaysOnTop(true, 'screen-saver');
  return id;
}
    