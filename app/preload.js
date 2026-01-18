const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  sendAudio: (buffer) => ipcRenderer.send('process-audio', buffer),
  onTranscriptionResult: (callback) => ipcRenderer.on('transcription-data', (_, data) => callback(data)),
  openFileDialog: () => ipcRenderer.invoke('dialog:openFile')
});