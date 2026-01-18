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
  
  console.log('Running Python script:', scriptPath);
  console.log('With file:', filePath);
  console.log('Using Python:', pythonPath);

  const py = spawn(pythonPath, [scriptPath, filePath], {
    cwd: path.join(__dirname, '..')
  });

  let output = '';
  let errorOutput = '';
  
  py.stdout.on('data', (data) => {
    const chunk = data.toString();
    console.log('Python stdout:', chunk);
    output += chunk;
  });

  py.stderr.on('data', (data) => {
    const chunk = data.toString();
    console.error('Python stderr:', chunk);
    errorOutput += chunk;
  });

  py.on('close', (code) => {
    console.log('Python process exited with code:', code);
    if (code === 0 && window) {
      try {
        console.log('Attempting to parse output, length:', output.length);
        const slideData = JSON.parse(output);
        console.log('Successfully parsed slide data:', slideData.total_pages, 'pages');
        console.log('Sending slides-loaded event to window');
        window.webContents.send('slides-loaded', slideData);
      } catch (e) {
        console.error('Failed to parse Python output:', e);
        window.webContents.send('slides-loaded', { 
          status: 'error', 
          message: 'Failed to parse output: ' + e.message 
        });
      }
    } else if (code !== 0) {
      console.error('Python script failed');
      window.webContents.send('slides-loaded', { 
        status: 'error', 
        message: 'Python error: ' + errorOutput 
      });
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
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