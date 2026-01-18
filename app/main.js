const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const pythonPath = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
const serverScript = path.join(projectRoot, 'python', 'server.py');

let python = null;
let mainWindow = null;

// Debug logging
const log = (tag, msg) => console.log(`[main.js] [${tag}] ${msg}`);

// Start streaming transcription server
function startPython() {
  log('STARTUP', 'Spawning Python server...');
  python = spawn(pythonPath, [serverScript]);

  let buffer = '';
  python.stdout.on('data', data => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.trim()) {
        try {
          const msg = JSON.parse(line);
          log('FROM_PYTHON', `${msg.type}${msg.text ? ': ' + msg.text.substring(0, 30) : ''}`);
          mainWindow?.webContents.send('transcript', msg);
        } catch (e) { }
      }
    }
  });

  python.stderr.on('data', d => console.log('[Python]', d.toString()));
  python.on('close', code => console.log('Python exited:', code));
}

function sendToPython(msg) {
  if (python) {
    if (msg.type !== 'audio') log('TO_PYTHON', `${msg.type}`);
    python.stdin.write(JSON.stringify(msg) + '\n');
  }
}

// Audio streaming IPC
ipcMain.on('audio-chunk', (_, data) => sendToPython({ type: 'audio', data }));
ipcMain.on('reset', () => sendToPython({ type: 'reset' }));
ipcMain.on('goto-slide', (_, index) => sendToPython({ type: 'goto_slide', index }));

// File upload dialog
ipcMain.handle('dialog:openFile', async () => {
  log('UPLOAD', 'Opening file dialog...');
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Presentations', extensions: ['pdf', 'pptx'] }]
  });

  if (!canceled && filePaths[0]) {
    log('UPLOAD', `File selected: ${filePaths[0]}`);
    runSlideParser(filePaths[0]);
    return filePaths[0];
  }
  log('UPLOAD', 'Dialog canceled');
});

// Parse slides with Python
function runSlideParser(filePath) {
  log('PARSE', 'Starting slide parser...');
  const scriptPath = path.join(projectRoot, 'python', 'parse_slides.py');
  const py = spawn(pythonPath, [scriptPath, filePath]);

  let output = '';
  py.stdout.on('data', data => output += data.toString());
  py.stderr.on('data', data => console.error('[SlideParser]', data.toString()));

  py.on('close', code => {
    log('PARSE', `Parser exited with code ${code}`);
    if (code === 0) {
      try {
        const slideData = JSON.parse(output);
        log('PARSE', `Parsed ${slideData.total_pages} slides`);
        log('FLOW', '→ Sending slides-loaded to renderer');
        mainWindow?.webContents.send('slides-loaded', slideData);
        log('FLOW', '→ Sending load_slides to Python server');
        sendToPython({ type: 'load_slides', slides: slideData.slides });
      } catch (e) {
        console.error('Failed to parse slide output:', e);
      }
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  startPython();
  createWindow();
});

app.on('window-all-closed', () => {
  if (python) python.kill();
  app.quit();
});
