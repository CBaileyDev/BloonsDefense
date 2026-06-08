'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Expose a safe, minimal API surface to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  getPlatformInfo: () => ipcRenderer.invoke('get-platform-info'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  getFullscreen: () => ipcRenderer.invoke('get-fullscreen'),
  setTitle: (title) => ipcRenderer.invoke('set-title', title),
  openExternal: (url) => ipcRenderer.send('open-external', url),
});
