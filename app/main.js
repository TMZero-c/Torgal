const { app, BrowserWindow, ipcMain } = require('electron/main');
const { spawn } = require('child_process');
const path = require('node:path');
const fs = require('fs');

// app/ -> root
const projectRoot = path.join(__dirname, '..');
const pythonPath = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
const transcribeScript = path.join(projectRoot, 'python', 'transcribe.py');

function transcribe(audioPath) {
  return new Promise((resolve, reject) => {
    const py = spawn(pythonPath, [transcribeScript, audioPath]);
    let out = '';
    py.stdout.on('data', d => out += d);
    py.stderr.on('data', d => console.error('[Python]', d.toString()));
    py.on('close', code => {
      if (code === 0) resolve(JSON.parse(out));
      else reject(`Exit code ${code}`);
    });
  });
}

ipcMain.on('process-audio', async (event, buffer) => {
  const tempFile = path.join(app.getPath('temp'), 'recording.wav');
  fs.writeFileSync(tempFile, Buffer.from(buffer));
  try {
    const result = await transcribe(tempFile);
    event.reply('transcription-data', result.text);
  } catch (e) {
    console.error(e);
    event.reply('transcription-data', 'Error transcribing');
  }
});

function createWindow() {
  const win = new BrowserWindow({
    width: 400,
    height: 500,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());