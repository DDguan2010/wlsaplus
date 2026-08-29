const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('captureSelection', {
  onInit: (callback) => ipcRenderer.once('capture:init', (_event, value) => callback(value)),
  complete: (value) => ipcRenderer.send('capture:result', value),
});
