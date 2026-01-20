const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('prefsApi', {
    getSettings: () => ipcRenderer.invoke('prefs:getSettings'),
    saveSettings: (settings) => ipcRenderer.invoke('prefs:saveSettings', settings),
    getModelCachePath: () => ipcRenderer.invoke('prefs:getModelCachePath'),
    openCacheFolder: () => ipcRenderer.invoke('prefs:openCacheFolder'),
    clearCache: () => ipcRenderer.invoke('prefs:clearCache'),
    restartApp: () => ipcRenderer.send('prefs:restartApp'),
});
