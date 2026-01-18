const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Audio streaming
    sendAudioChunk: (base64) => ipcRenderer.send('audio-chunk', base64),
    reset: () => ipcRenderer.send('reset'),
    gotoSlide: (index) => ipcRenderer.send('goto-slide', index),
    onTranscript: (cb) => ipcRenderer.on('transcript', (_, msg) => cb(msg)),
    
    // File upload
    openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),
    onSlidesLoaded: (cb) => ipcRenderer.on('slides-loaded', (_, data) => cb(data))
});
