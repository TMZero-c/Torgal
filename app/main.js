const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Presentations', extensions: ['pdf', 'pptx'] }
    ]
  });

  if (!canceled) {
    const selectedPath = filePaths[0];
    
    // TEST STEP: Send this path to your Python script immediately
    runPythonParser(selectedPath); 
    
    return selectedPath;
  }
});

function runPythonParser(filePath) {
  const { spawn } = require('child_process');
  // Adjust 'python' to 'python3' or your venv path as needed
  const py = spawn('python', ['parse_slides.py', filePath]);

  py.stdout.on('data', (data) => {
    console.log(`Python Output: ${data.toString()}`);
  });

  py.stderr.on('data', (data) => {
    console.error(`Python Error: ${data.toString()}`);
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