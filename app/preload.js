const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Audio streaming (renderer → main → Python)
    // Payload can be string (base64) or object { data, rms, silent }
    sendAudioChunk: (payload) => ipcRenderer.send('audio-chunk', payload),
    reset: () => ipcRenderer.send('reset'),
    gotoSlide: (index) => ipcRenderer.send('goto-slide', index),
    onTranscript: (cb) => ipcRenderer.on('transcript', (_, msg) => cb(msg)),

    // File upload / slide parsing
    openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
    onSlidesLoaded: (cb) => ipcRenderer.on('slides-loaded', (_, data) => cb(data))
});
