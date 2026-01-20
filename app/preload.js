const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
    // Audio streaming (renderer → main → Python)
    // Payload can be string (base64) or object { data, rms, silent }
    sendAudioChunk: (payload) => ipcRenderer.send('audio-chunk', payload),
    reset: () => ipcRenderer.send('reset'),
    gotoSlide: (index) => ipcRenderer.send('goto-slide', index),
    setQaMode: (isQaMode) => ipcRenderer.send('set-qa-mode', { qa_mode: isQaMode }),
    toggleAudioPause: (paused) => ipcRenderer.send('toggle-audio-pause', paused),

    // File dialog
    openFileDialog: () => ipcRenderer.invoke('dialog:openFile'),

    // Event subscriptions
    onSlidesLoaded: (callback) => ipcRenderer.on('slides-loaded', (_event, data) => callback(data)),
    onTranscript: (callback) => ipcRenderer.on('transcript', (_event, msg) => callback(msg)),
    onPauseAudio: (callback) => ipcRenderer.on('pause-audio', (_event, data) => callback(data)),
    onSettingsLoaded: (callback) => ipcRenderer.on('settings-loaded', (_event, settings) => callback(settings)),
    onPythonError: (callback) => ipcRenderer.on('python-error', (_event, data) => callback(data))
});
