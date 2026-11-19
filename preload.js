const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, arg) => ipcRenderer.invoke(channel, arg);

contextBridge.exposeInMainWorld('api', {
  getData: () => call('data:get'),
  login: code => call('auth:login', code),
  logout: () => call('auth:logout'),
  setupCoach: code => call('auth:setup', { code }),
  savePlayer: p => call('player:save', p),
  newCode: () => call('player:newCode'),
  deletePlayer: id => call('player:delete', id),
  updateGame: (matchId, playerId, fields) => call('game:update', { matchId, playerId, fields }),
  deleteGame: (matchId, playerId) => call('game:delete', { matchId, playerId }),
  saveSession: s => call('session:save', s),
  deleteSession: id => call('session:delete', id),
  saveSettings: patch => call('settings:save', patch),
  setCoachCode: code => call('coach:code', code),
  saveKey: key => call('key:save', key),
  saveCloudSecret: secret => call('cloud:secret', secret),
  checkCloud: () => call('cloud:check'),
  exportBackup: () => call('backup:export'),
  importBackup: () => call('backup:import'),
  openExternal: url => call('open:external', url),
  uiState: ui => ipcRenderer.send('ui:state', ui),
  booking: (action, id, start) => call('booking:action', { action, id, start }),
  saveReport: (sessionId, data) => call('report:save', { sessionId, data }),
  refreshBookings: () => call('booking:refresh'),
  refreshLive: () => call('live:refresh'),
  watchLive: gameId => call('live:watch', gameId),
  getMoments: (playerId, matchId) => call('moments:get', { playerId, matchId }),
  onAlert: cb => ipcRenderer.on('coach:alert', (e, v) => cb(v)),
  onData: cb => ipcRenderer.on('data:changed', (e, v) => cb(v))
});
