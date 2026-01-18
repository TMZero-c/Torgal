const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Audio streaming (renderer → main → Python)
    // Payload can be string (base64) or object { data, rms, silent }
    sendAudioChunk: (payload) => ipcRenderer.send('audio-chunk', payload),
    reset: () => ipcRenderer.send('reset'),
    gotoSlide: (index) => ipcRenderer.send('goto-slide', index),
    setQaMode: (isQaMode) => ipcRenderer.send('set-qa-mode', { qa_mode: isQaMode }),
