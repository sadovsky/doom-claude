const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // settings
  getSettings:   (key, def)  => ipcRenderer.invoke('settings:get', key, def),
  setSettings:   (key, val)  => ipcRenderer.invoke('settings:set', key, val),

  // platform info
  platform: process.platform,

  // Claude Code session reading
  listSessions:  ()          => ipcRenderer.invoke('claude:listSessions'),
  readUsage:     (jsonlPath) => ipcRenderer.invoke('claude:readUsage', jsonlPath),
});
