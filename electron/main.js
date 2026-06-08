'use strict';

const { app, BrowserWindow, ipcMain, screen, shell } = require('electron');
const path = require('path');
const os = require('os');

// ── M5 Apple Silicon GPU acceleration flags ─────────────────────────────────
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('enable-oop-rasterization');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-features', 'Metal,Vulkan,UseSkiaRenderer,CanvasOopRasterization');
app.commandLine.appendSwitch('disable-frame-rate-limit');

// ── Dev helpers ─────────────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === 'development';
const isMac = process.platform === 'darwin';
const isArm = os.arch() === 'arm64';

let mainWindow = null;

// ── Window creation ─────────────────────────────────────────────────────────
function createWindow() {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;

  // Default: 1440×900 centered, or fullscreen on smaller screens
  const winW = Math.min(1440, sw);
  const winH = Math.min(900, sh);

  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    minWidth: 1024,
    minHeight: 640,
    center: true,
    show: false,                   // show after ready-to-show
    backgroundColor: '#0a0a0f',   // prevent white flash
    title: 'Thornward',

    // macOS native chrome
    ...(isMac ? {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
    } : {
      frame: true,
    }),

    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      // M5: hardware-accelerated compositing
      offscreen: false,
    },
  });

  // Load the renderer
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Show window once DOM is ready (avoids flash)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // Log GPU info in dev mode
  if (isDev) {
    mainWindow.webContents.on('did-finish-load', () => {
      console.log(`[Thornward] Window ready | platform: ${process.platform} | arch: ${os.arch()}`);
      console.log(`[Thornward] GPU acceleration active`);
    });
  }

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();

  // macOS: re-open window on dock click
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});

// ── IPC handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('get-platform-info', () => ({
  platform: process.platform,
  arch: os.arch(),
  isArm,
  isMac,
  nodeVersion: process.version,
  electronVersion: process.versions.electron,
}));

ipcMain.handle('toggle-fullscreen', () => {
  if (!mainWindow) return;
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
  return mainWindow.isFullScreen();
});

ipcMain.handle('get-fullscreen', () => {
  return mainWindow ? mainWindow.isFullScreen() : false;
});

ipcMain.handle('set-title', (_, title) => {
  if (mainWindow) mainWindow.setTitle(title);
});

// Open external links in system browser, not in-app
ipcMain.on('open-external', (_, url) => {
  shell.openExternal(url);
});
