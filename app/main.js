const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const pythonPath = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
const serverScript = path.join(projectRoot, 'python', 'server.py');

let python = null;
let presenterWin = null;
let slideshowWin = null;

function startPython() {
  console.log('Starting Python server from:', serverScript);
  python = spawn(pythonPath, [serverScript]);

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
          // Broadcast to both windows
          [presenterWin, slideshowWin].forEach(win => {
            if (win && !win.isDestroyed()) win.webContents.send('transcript', msg);
          });
        } catch (e) { }
      }
    }
  });

  python.stderr.on('data', d => console.log('[Python Error]', d.toString()));
  python.on('error', err => console.error('[Python Start Error]', err));
}

function sendToPython(msg) {
  if (python) python.stdin.write(JSON.stringify(msg) + '\n');
}

ipcMain.on('audio-chunk', (_, data) => sendToPython({ type: 'audio', data }));
ipcMain.on('reset', () => sendToPython({ type: 'reset' }));
ipcMain.on('goto-slide', (_, index) => sendToPython({ type: 'goto_slide', index }));

ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(presenterWin, {
    properties: ['openFile'],
    filters: [{ name: 'Presentations', extensions: ['pdf', 'pptx'] }]
  });

  if (!canceled && filePaths[0]) {
    runSlideParser(filePaths[0]);
    return filePaths[0];
  }
});

function runSlideParser(filePath) {
  const scriptPath = path.join(projectRoot, 'python', 'parse_slides.py');
  const py = spawn(pythonPath, [scriptPath, filePath]);
  let output = '';
  py.stdout.on('data', data => output += data.toString());
  py.on('close', code => {
    if (code === 0) {
      try {
        const slideData = JSON.parse(output);
        [presenterWin, slideshowWin].forEach(win => {
          if (win && !win.isDestroyed()) win.webContents.send('slides-loaded', slideData);
        });
        sendToPython({ type: 'load_slides', slides: slideData.slides });
      } catch (e) { console.error(e); }
    }
  });
}

function createWindows() {
  const displays = screen.getAllDisplays();
  const externalDisplay = displays.find((d) => d.bounds.x !== 0 || d.bounds.y !== 0);

  presenterWin = new BrowserWindow({
    width: 1100, height: 900,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  presenterWin.loadFile(path.join(__dirname, 'index.html'));
  presenterWin.webContents.openDevTools();

  slideshowWin = new BrowserWindow({
    width: 800, height: 600,
    x: externalDisplay ? externalDisplay.bounds.x : 0,
    y: externalDisplay ? externalDisplay.bounds.y : 0,
    fullscreen: !!externalDisplay,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  slideshowWin.loadFile(path.join(__dirname, 'slideshow.html'));
}

app.whenReady().then(() => {
  startPython();
  createWindows();
});

app.on('window-all-closed', () => {
  if (python) python.kill();
  app.quit();
});