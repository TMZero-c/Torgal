const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow;

ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Presentations', extensions: ['pdf', 'pptx'] }
    ]
  });

  if (!canceled) {
    const selectedPath = filePaths[0];
    runPythonParser(selectedPath, mainWindow);
    return selectedPath;
  }
});

function runPythonParser(filePath, window) {
  const pythonPath = path.join(__dirname, '..', '.venv', 'Scripts', 'python.exe');
  const scriptPath = path.join(__dirname, '..', 'python', 'parse_slides.py');
  const py = spawn(pythonPath, [scriptPath, filePath]);

  let output = '';
  py.stdout.on('data', (data) => {
    output += data.toString();
  });

  py.stderr.on('data', (data) => {
    console.error(`Python Error: ${data.toString()}`);
  });

  py.on('close', (code) => {
    if (code === 0 && window) {
      try {
        const slideData = JSON.parse(output);
        window.webContents.send('slides-loaded', slideData);
      } catch (e) {
        console.error('Failed to parse Python output:', e);
      }
    }
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile('index.html');
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});