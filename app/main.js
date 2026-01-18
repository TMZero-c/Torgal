const { app, BrowserWindow, ipcMain } = require('electron/main');
const { spawn } = require('child_process');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const pythonPath = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
const serverScript = path.join(projectRoot, 'python', 'server.py');

let python = null;
let mainWindow = null;

function startPython() {
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
          mainWindow?.webContents.send('transcript', msg);
        } catch (e) { }
      }
    }
  });

  python.stderr.on('data', d => console.log('[Python]', d.toString()));
  python.on('close', code => console.log('Python exited:', code));
}

function sendToPython(msg) {
  if (python) python.stdin.write(JSON.stringify(msg) + '\n');
}

ipcMain.on('audio-chunk', (_, data) => sendToPython({ type: 'audio', data }));
ipcMain.on('reset', () => sendToPython({ type: 'reset' }));
ipcMain.on('goto-slide', (_, index) => sendToPython({ type: 'goto_slide', index }));

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 850,
    height: 700,
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
