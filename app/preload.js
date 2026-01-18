const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    sendAudioChunk: (base64) => ipcRenderer.send('audio-chunk', base64),
    reset: () => ipcRenderer.send('reset'),
    gotoSlide: (index) => ipcRenderer.send('goto-slide', index),
    onTranscript: (cb) => ipcRenderer.on('transcript', (_, msg) => cb(msg))
});
