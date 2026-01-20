const { app, BrowserWindow, ipcMain, dialog, screen, Menu, shell } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const Store = require('./store');

const projectRoot = path.join(__dirname, '..');

// Initialize settings store with defaults
const store = new Store({
  configName: 'torgal-settings',
  defaults: {
    // Audio settings
    audioSampleRate: 16000,
    audioChunkSize: 1024,
    silenceRmsThreshold: 0.01,
    silenceSmoothing: 0.7,
    audioBufferSeconds: 8,

    // Matching settings
    matchThreshold: 0.55,
    matchCooldownWords: 4,
    matchDiff: 0.09,
    windowWords: 14,
    stayBiasMargin: 0.02,
    forwardBiasMargin: 0.06,
    backBiasMargin: 0.02,

    // Model settings
    whisperModel: 'distil-large-v3.5',
    whisperDevice: 'cuda',
    whisperComputeType: 'float16',
    embeddingModel: 'BAAI/bge-base-en-v1.5',

    // Voice command settings
    triggerCooldownMs: 1500,
    triggerTailWords: 6,

    // Partial matching
    partialFinalizeMs: 1000,
    partialMatchMinWords: 5,

    // Q&A mode
    qaWindowWords: 24,
    qaMatchThreshold: 0.60,
  }
});

function isWindows() {
  return process.platform === 'win32';
}

function resolvePythonCommand() {
  // Priority:
  // 1) Explicit env override
  // 2) Dev venv at repo root
  // 3) Windows launcher 'py -3'
  // 4) python or python3 on PATH
  // Note: When packaged, we use bundled executables directly, not Python
  const candidates = [];

  if (process.env.PYTHON_PATH) candidates.push(process.env.PYTHON_PATH);

  if (isWindows()) {
    candidates.push(path.join(projectRoot, '.venv', 'Scripts', 'python.exe'));
  } else {
    candidates.push(path.join(projectRoot, '.venv', 'bin', 'python'));
  }

  // PATH-level fallbacks (do not existsSync these)
  if (isWindows()) candidates.push('py');
  candidates.push('python3');
  candidates.push('python');

  for (const cmd of candidates) {
    // If it's a bare command, just return it; we'll handle spawn errors later.
    if (!cmd.includes(path.sep)) return cmd;
    try {
      if (fs.existsSync(cmd)) return cmd;
    } catch (_) { }
  }
  return null;
}

// Resolve bundled executable path (for packaged app)
function resolveBundledExe(exeName) {
  const exeFile = isWindows() ? `${exeName}.exe` : exeName;

  // When packaged, look in resources folder (standalone exe)
  if (app.isPackaged && process.resourcesPath) {
    // New: standalone exe directly in resources
    const standaloneExe = path.join(process.resourcesPath, exeFile);
    if (fs.existsSync(standaloneExe)) return standaloneExe;

    // Legacy: exe in subfolder
    const exePath = path.join(process.resourcesPath, exeName, exeFile);
    if (fs.existsSync(exePath)) return exePath;
  }

  // Dev mode: check if dist folder exists (for testing bundled builds)
  // New: standalone exe
  const devStandaloneExe = path.join(projectRoot, 'python', 'dist', exeFile);
  if (fs.existsSync(devStandaloneExe)) return devStandaloneExe;

  // Legacy: exe in subfolder
  const devExePath = path.join(projectRoot, 'python', 'dist', exeName, exeFile);
  if (fs.existsSync(devExePath)) return devExePath;

  return null;
}

function resolvePythonScript(scriptName) {
  // Try multiple locations to support dev and packaged with asar unpack.
  const locations = [
    // When packaged and asar unpacked
    path.join(process.resourcesPath || '', 'app.asar.unpacked', 'python', scriptName),
    // When we explicitly copy python into resources (rare)
    path.join(process.resourcesPath || '', 'python', scriptName),
    // Dev path from repo root
    path.join(projectRoot, 'python', scriptName),
  ].filter(Boolean);

  for (const p of locations) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) { }
  }
  // Fall back to dev path; spawn will report error if missing
  return path.join(projectRoot, 'python', scriptName);
}

let pythonCmd = null;
let serverScript = resolvePythonScript('server.py');

let python = null;
let presenterWin = null;
let slideshowWin = null;
let preferencesWin = null;

// Track if we're currently processing a presentation to pause audio
let isPresentationLoading = false;

// Debug logging (tags make tracing main/renderer easier)
const log = (tag, msg) => console.log(`[main.js] [${tag}] ${msg}`);

// Broadcast to both windows (presenter + slideshow)
function broadcast(channel, data) {
  [presenterWin, slideshowWin].forEach(win => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  });
}

let lastStatus = null;

function broadcastStatus(status, data = {}) {
  lastStatus = { type: 'status', status, ...data };
  broadcast('transcript', lastStatus);
}

function sendLastStatus(win) {
  if (lastStatus && win && !win.isDestroyed()) {
    win.webContents.send('transcript', lastStatus);
  }
}

// Get model cache path (for HuggingFace models)
function getModelCachePath() {
  // HuggingFace cache is typically in user home
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const hfCache = path.join(homeDir, '.cache', 'huggingface');
  return hfCache;
}

function startPython() {
  // Python server streams newline-delimited JSON on stdout.
  log('STARTUP', 'Spawning Python server...');
  broadcastStatus('model_loading');

  // Pass settings to Python via environment variables
  const settings = store.getAll();
  const env = {
    ...process.env,
    PYTHONIOENCODING: 'utf-8',
    // Model settings
    TORGAL_WHISPER_MODEL: settings.whisperModel,
    TORGAL_WHISPER_DEVICE: settings.whisperDevice,
    TORGAL_WHISPER_COMPUTE_TYPE: settings.whisperComputeType,
    TORGAL_EMBEDDING_MODEL: settings.embeddingModel,
    // Audio settings
    TORGAL_SAMPLE_RATE: String(settings.audioSampleRate),
    TORGAL_AUDIO_BUFFER_SECONDS: String(settings.audioBufferSeconds),
    // Matching settings
    TORGAL_MATCH_THRESHOLD: String(settings.matchThreshold),
    TORGAL_MATCH_COOLDOWN_WORDS: String(settings.matchCooldownWords),
    TORGAL_MATCH_DIFF: String(settings.matchDiff),
    TORGAL_WINDOW_WORDS: String(settings.windowWords),
    TORGAL_STAY_BIAS_MARGIN: String(settings.stayBiasMargin),
    TORGAL_FORWARD_BIAS_MARGIN: String(settings.forwardBiasMargin),
    TORGAL_BACK_BIAS_MARGIN: String(settings.backBiasMargin),
    // Voice command settings
    TORGAL_TRIGGER_COOLDOWN_MS: String(settings.triggerCooldownMs),
    TORGAL_TRIGGER_TAIL_WORDS: String(settings.triggerTailWords),
    // Partial matching
    TORGAL_PARTIAL_FINALIZE_MS: String(settings.partialFinalizeMs),
    TORGAL_PARTIAL_MATCH_MIN_WORDS: String(settings.partialMatchMinWords),
    // Q&A mode
    TORGAL_QA_WINDOW_WORDS: String(settings.qaWindowWords),
    TORGAL_QA_MATCH_THRESHOLD: String(settings.qaMatchThreshold),
  };

  // Check for bundled executable first
  const bundledServer = resolveBundledExe('server');
  if (bundledServer) {
    log('STARTUP', `Using bundled executable: ${bundledServer}`);
    python = spawn(bundledServer, [], { env });
  } else {
    // Fall back to Python interpreter
    if (!pythonCmd) pythonCmd = resolvePythonCommand();
    const args = [];
    if (pythonCmd === 'py' && isWindows()) {
      args.push('-3');
    }
    args.push(serverScript);
    log('STARTUP', `Using Python: ${pythonCmd} ${args.join(' ')}`);
    python = spawn(pythonCmd || 'python', args, { env });
  }

  let buffer = '';
  python.stdout.on('data', data => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) {
        console.log('[Python Output]', line);
        try {
          const msg = JSON.parse(line);
          log('FROM_PYTHON', `${msg.type}${msg.text ? ': ' + msg.text.substring(0, 30) : ''}`);
          if (msg.type === 'ready') {
            broadcastStatus('model_ready');
          }
          broadcast('transcript', msg);
        } catch (e) { }
      }
    }
  });

  python.stderr.on('data', d => console.log('[Python Error]', d.toString()));
  python.on('error', err => console.error('[Python Start Error]', err));
}

function sendToPython(msg) {
  if (python) {
    // Avoid spamming logs with audio chunks.
    if (msg.type !== 'audio') log('TO_PYTHON', `${msg.type}`);
    python.stdin.write(JSON.stringify(msg) + '\n');
  }
}

ipcMain.on('audio-chunk', (_, payload) => {
  // Don't process audio while loading a new presentation
  if (isPresentationLoading) return;

  // Payload can be a base64 string or an object with rms/silence metadata.
  if (typeof payload === 'string') {
    sendToPython({ type: 'audio', data: payload });
  } else {
    sendToPython({ type: 'audio', ...payload });
  }
});
ipcMain.on('reset', () => sendToPython({ type: 'reset' }));
ipcMain.on('goto-slide', (_, index) => sendToPython({ type: 'goto_slide', index }));
ipcMain.on('set-qa-mode', (_, payload) => {
  const qaMode = Boolean(payload?.qa_mode);
  sendToPython({ type: 'set_qa_mode', qa_mode: qaMode });
});

// Preferences IPC handlers
ipcMain.handle('prefs:getSettings', () => store.getAll());
ipcMain.handle('prefs:saveSettings', (_, settings) => {
  store.setAll(settings);
  return true;
});
ipcMain.handle('prefs:getModelCachePath', () => getModelCachePath());
ipcMain.handle('prefs:openCacheFolder', async () => {
  const cachePath = getModelCachePath();
  if (fs.existsSync(cachePath)) {
    shell.openPath(cachePath);
  }
});
ipcMain.handle('prefs:clearCache', async () => {
  const cachePath = getModelCachePath();
  try {
    if (fs.existsSync(cachePath)) {
      const stats = await fs.promises.stat(cachePath);
      // Calculate size before deletion
      let totalSize = 0;
      const calcSize = async (dir) => {
        const files = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const file of files) {
          const filePath = path.join(dir, file.name);
          if (file.isDirectory()) {
            await calcSize(filePath);
          } else {
            const stat = await fs.promises.stat(filePath);
            totalSize += stat.size;
          }
        }
      };
      await calcSize(cachePath);

      // Delete the cache
      await fs.promises.rm(cachePath, { recursive: true, force: true });
      return { success: true, freedMB: Math.round(totalSize / (1024 * 1024)) };
    }
    return { success: true, freedMB: 0 };
  } catch (e) {
    return { success: false, error: e.message };
  }
});
ipcMain.on('prefs:restartApp', () => {
  app.relaunch();
  app.exit(0);
});

// Audio pause toggle from renderer
ipcMain.on('toggle-audio-pause', (_, paused) => {
  isPresentationLoading = paused;
  log('AUDIO', `Audio ${paused ? 'paused' : 'resumed'} by user`);
  if (paused) {
    // Also tell Python to reset when pausing
    sendToPython({ type: 'reset' });
  }
});

ipcMain.handle('dialog:openFile', async () => {
  log('UPLOAD', 'Opening file dialog...');
  if (!presenterWin) {
    log('UPLOAD', 'ERROR: presenterWin is not defined');
    return null;
  }

  const { canceled, filePaths } = await dialog.showOpenDialog(presenterWin, {
    properties: ['openFile'],
    filters: [{ name: 'Presentations', extensions: ['pdf', 'pptx'] }]
  });

  if (!canceled && filePaths[0]) {
    log('UPLOAD', `File selected: ${filePaths[0]}`);
    runSlideParser(filePaths[0]);
    return filePaths[0];
  }
  log('UPLOAD', 'Dialog canceled');
  return null;
});

function runSlideParser(filePath) {
  // Parse slides in a short-lived Python process (returns images + text).
  log('PARSE', 'Starting slide parser...');

  // Pause audio processing and reset Python state when loading a new presentation
  isPresentationLoading = true;
  sendToPython({ type: 'reset' });
  broadcast('pause-audio', {});

  broadcastStatus('slides_processing', { file: filePath });
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };

  let py;
  // Check for bundled executable first
  const bundledParser = resolveBundledExe('parse_slides');
  if (bundledParser) {
    log('PARSE', `Using bundled executable: ${bundledParser}`);
    py = spawn(bundledParser, [filePath], { env });
  } else {
    // Fall back to Python interpreter
    const scriptPath = resolvePythonScript('parse_slides.py');
    if (!pythonCmd) pythonCmd = resolvePythonCommand();
    const args = [];
    if (pythonCmd === 'py' && isWindows()) args.push('-3');
    args.push(scriptPath, filePath);
    log('PARSE', `Using Python: ${pythonCmd} ${args.join(' ')}`);
    py = spawn(pythonCmd || 'python', args, { env });
  }

  let output = '';
  py.stdout.on('data', data => output += data.toString());
  py.on('error', err => {
    log('PARSE', `Parser error: ${err.message}`);
    isPresentationLoading = false;
    broadcastStatus('slides_failed', { message: err.message });
  });
  py.on('close', code => {
    log('PARSE', `Parser exited with code ${code}`);
    isPresentationLoading = false;
    if (code !== 0) {
      broadcastStatus('slides_failed', { code });
      return;
    }
    try {
      const slideData = JSON.parse(output);
      if (slideData.status === 'success') {
        log('PARSE', `Parsed ${slideData.total_pages} slides`);
        broadcastStatus('slides_ready', { count: slideData.total_pages });

        // Create slideshow window if it doesn't exist
        createSlideshowWindow();

        // Wait a moment for the slideshow window to load before broadcasting
        setTimeout(() => {
          log('FLOW', '-> Sending slides-loaded to both windows');
          broadcast('slides-loaded', slideData);
          log('FLOW', '-> Sending load_slides to Python server');
          sendToPython({ type: 'load_slides', slides: slideData.slides });
        }, 500);
      } else {
        broadcastStatus('slides_failed', { message: slideData.message || 'Slide parse failed' });
        log('FLOW', '-> Sending slides-loaded error to both windows');
        broadcast('slides-loaded', slideData);
      }
    } catch (e) {
      broadcastStatus('slides_failed', { message: 'Invalid slide parser output' });
      console.error(e);
    }
  });
}

function openPreferences() {
  if (preferencesWin && !preferencesWin.isDestroyed()) {
    preferencesWin.focus();
    return;
  }

  preferencesWin = new BrowserWindow({
    width: 600,
    height: 700,
    parent: presenterWin,
    modal: false,
    resizable: true,
    icon: path.join(__dirname, 'assets/IMPORTANT.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-prefs.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  preferencesWin.loadFile(path.join(__dirname, 'preferences.html'));
  preferencesWin.setTitle('Preferences - Torgal');
  preferencesWin.setMenuBarVisibility(false);

  preferencesWin.on('closed', () => {
    preferencesWin = null;
  });
}

function createMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Preferences...',
          accelerator: 'Cmd+,',
          click: openPreferences
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Presentation...',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            if (!presenterWin) return;
            const { canceled, filePaths } = await dialog.showOpenDialog(presenterWin, {
              properties: ['openFile'],
              filters: [{ name: 'Presentations', extensions: ['pdf', 'pptx'] }]
            });
            if (!canceled && filePaths[0]) {
              runSlideParser(filePaths[0]);
            }
          }
        },
        { type: 'separator' },
        ...(!isMac ? [{
          label: 'Preferences...',
          accelerator: 'Ctrl+,',
          click: openPreferences
        }] : []),
        ...(!isMac ? [{ type: 'separator' }] : []),
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      ]
    },
    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' }
        ] : [
          { role: 'close' }
        ])
      ]
    },
    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Torgal',
          click: () => {
            dialog.showMessageBox(presenterWin, {
              type: 'info',
              title: 'About Torgal',
              message: 'Torgal',
              detail: 'Local-first AI presentation slide advancer\n\nVersion 1.0.0\n\nBy TMZero-c & Googolplexic'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function createWindows() {
  presenterWin = new BrowserWindow({
    width: 1100, height: 900,
    icon: path.join(__dirname, 'assets/IMPORTANT.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  presenterWin.loadFile(path.join(__dirname, 'index.html'));
  presenterWin.setTitle('Torgal (presenter)');
  presenterWin.webContents.on('did-finish-load', () => {
    sendLastStatus(presenterWin);
    // Send current settings to renderer
    presenterWin.webContents.send('settings-loaded', store.getAll());
  });

  // Slideshow window is created when slides are loaded (not on startup)
}

function createSlideshowWindow() {
  if (slideshowWin && !slideshowWin.isDestroyed()) {
    // Already exists, just focus it
    slideshowWin.focus();
    return;
  }

  const displays = screen.getAllDisplays();
  const externalDisplay = displays.find((d) => d.bounds.x !== 0 || d.bounds.y !== 0);

  slideshowWin = new BrowserWindow({
    width: 800, height: 600,
    x: externalDisplay ? externalDisplay.bounds.x : 0,
    y: externalDisplay ? externalDisplay.bounds.y : 0,
    fullscreen: !!externalDisplay,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets/IMPORTANT.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  slideshowWin.loadFile(path.join(__dirname, 'slideshow.html'));
  slideshowWin.setTitle('Torgal (Slideshow)');
  slideshowWin.webContents.on('did-finish-load', () => sendLastStatus(slideshowWin));

  slideshowWin.on('closed', () => {
    slideshowWin = null;
  });
}

app.whenReady().then(() => {
  createMenu();
  startPython();
  createWindows();
});

app.on('window-all-closed', () => {
  if (python) python.kill();
  app.quit();
});