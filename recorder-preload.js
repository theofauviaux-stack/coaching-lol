// Pont de la fenêtre d'enregistrement (cachée) avec le processus principal.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('rec', {
  onStart: cb => ipcRenderer.on('rec:start', (e, v) => cb(v)),
  done: r => ipcRenderer.send('rec:done', r)
});
