const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopApp', {
  platform: process.platform,
  isElectron: true,
  toggleFullscreen: () => ipcRenderer.invoke('desktop:toggle-fullscreen'),
  getScreenSource: () => ipcRenderer.invoke('desktop:get-screen-source')
});
