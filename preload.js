const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getData: () => ipcRenderer.invoke('data:get'),
  savePlayer: p => ipcRenderer.invoke('player:save', p),
  deletePlayer: id => ipcRenderer.invoke('player:delete', id),
  updateGame: (matchId, playerId, fields) => ipcRenderer.invoke('game:update', { matchId, playerId, fields }),
  deleteGame: (matchId, playerId) => ipcRenderer.invoke('game:delete', { matchId, playerId }),
  saveSession: s => ipcRenderer.invoke('session:save', s),
  deleteSession: id => ipcRenderer.invoke('session:delete', id),
  saveSettings: patch => ipcRenderer.invoke('settings:save', patch),
  saveKey: key => ipcRenderer.invoke('key:save', key),
  sync: ids => ipcRenderer.invoke('sync:run', ids),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  openExternal: url => ipcRenderer.invoke('open:external', url),
  checkUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onProgress: cb => ipcRenderer.on('sync:progress', (e, v) => cb(v)),
  onData: cb => ipcRenderer.on('data:changed', (e, v) => cb(v)),
  onUpdate: cb => ipcRenderer.on('update:status', (e, v) => cb(v))
});
