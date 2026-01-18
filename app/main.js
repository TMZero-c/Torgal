const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const projectRoot = path.join(__dirname, '..');

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

  // When packaged, look in resources folder
  if (app.isPackaged && process.resourcesPath) {
    const exePath = path.join(process.resourcesPath, exeName, exeFile);
    if (fs.existsSync(exePath)) return exePath;
  }

  // Dev mode: check if dist folder exists (for testing bundled builds)
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

function startPython() {
  // Python server streams newline-delimited JSON on stdout.
  log('STARTUP', 'Spawning Python server...');
  broadcastStatus('model_loading');
  const env = { ...process.env, PYTHONIOENCODING: 'utf-8' };

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
    broadcastStatus('slides_failed', { message: err.message });
  });
  py.on('close', code => {
    log('PARSE', `Parser exited with code ${code}`);
    if (code !== 0) {
      broadcastStatus('slides_failed', { code });
      return;
    }
    try {
      const slideData = JSON.parse(output);
      if (slideData.status === 'success') {
        log('PARSE', `Parsed ${slideData.total_pages} slides`);
        broadcastStatus('slides_ready', { count: slideData.total_pages });
        log('FLOW', '-> Sending slides-loaded to both windows');
        broadcast('slides-loaded', slideData);
        log('FLOW', '-> Sending load_slides to Python server');
        sendToPython({ type: 'load_slides', slides: slideData.slides });
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

function createWindows() {
  const displays = screen.getAllDisplays();
  const externalDisplay = displays.find((d) => d.bounds.x !== 0 || d.bounds.y !== 0);

  presenterWin = new BrowserWindow({
    width: 1100, height: 900,
    icon: path.join(__dirname, 'assets/IMPORTANT.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  presenterWin.loadFile(path.join(__dirname, 'index.html'));
  presenterWin.setTitle('Torgal (presenter)');
  presenterWin.webContents.openDevTools();
  presenterWin.webContents.on('did-finish-load', () => sendLastStatus(presenterWin));

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
  slideshowWin.setTitle('Torgal (Analysis)');
  slideshowWin.webContents.on('did-finish-load', () => sendLastStatus(slideshowWin));
}

app.whenReady().then(() => {
  startPython();
  createWindows();
});

app.on('window-all-closed', () => {
  if (python) python.kill();
  app.quit();
});