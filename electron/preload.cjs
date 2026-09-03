const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('wlsaplus', {
  platform: { os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux' },
  credentials: {
    get: () => ipcRenderer.invoke('credentials:get'),
    set: (value) => ipcRenderer.invoke('credentials:set', value),
    clear: () => ipcRenderer.invoke('credentials:clear'),
  },
  powerschool: {
    request: (options) => ipcRenderer.invoke('powerschool:request', options),
    clearSession: (baseUrl) => ipcRenderer.invoke('powerschool:clear-session', baseUrl),
  },
  desktopCards: {
    list: () => ipcRenderer.invoke('cards:list'),
    add: (type) => ipcRenderer.invoke('cards:add', type),
    remove: (id) => ipcRenderer.invoke('cards:remove', id),
    closeAll: () => ipcRenderer.invoke('cards:close-all'),
    getSettings: () => ipcRenderer.invoke('cards:get-settings'),
    setSettings: (value) => ipcRenderer.invoke('cards:set-settings', value),
  },
  vpn: {
    status: () => ipcRenderer.invoke('vpn:status'),
    connect: (mode) => ipcRenderer.invoke('vpn:connect', mode),
    disconnect: () => ipcRenderer.invoke('vpn:disconnect'),
    restartElevated: (mode) => ipcRenderer.invoke('vpn:restart-elevated', mode),
    onStatus: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on('vpn:status', handler);
      return () => ipcRenderer.removeListener('vpn:status', handler);
    },
  },
  updater: {
    status: () => ipcRenderer.invoke('updater:status'),
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatus: (callback) => {
      const handler = (_event, status) => callback(status);
      ipcRenderer.on('updater:status', handler);
      return () => ipcRenderer.removeListener('updater:status', handler);
    },
  },
  translator: {
    translate: (text, source, target) => ipcRenderer.invoke('translator:translate', text, source, target),
    captureRegion: () => process.platform === 'win32'
      ? ipcRenderer.invoke('translator:capture-region')
      : Promise.reject(new Error('Screen translation is available on Windows only.')),
  },
});
