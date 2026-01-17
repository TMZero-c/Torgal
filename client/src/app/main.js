const { app, BrowserWindow } = require('electron/main')
const path = require('node:path')

const { spawn } = require('child_process');
const fs = require('fs');
const { ipcMain } = require('electron');

function runTranscription(audioFilePath) {
  return new Promise((resolve, reject) => {
    // Call the python executable with your script and the audio path
    const python = spawn('python', [
      path.join(__dirname, 'transcribe.py'),
      audioFilePath
    ]);

    let output = '';
    python.stdout.on('data', (data) => { output += data.toString(); });
    
    python.stderr.on('data', (data) => {
      console.error(`Python Error: ${data}`);
    });

    python.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(output));
        } catch (e) {
          reject("Failed to parse Python output");
        }
      } else {
        reject(`Process exited with code ${code}`);
      }
    });
  });
}

ipcMain.on('process-audio', async (event, arrayBuffer) => {
  const tempPath = path.join(app.getPath('temp'), 'input.wav');
  
  // 1. Save the buffer to a temporary file
  fs.writeFileSync(tempPath, Buffer.from(arrayBuffer));

  try {
    // 2. Run the transcription (using the function from the previous step)
    const result = await runTranscription(tempPath); 
    
    // 3. Send the text back to the UI
    event.reply('transcription-data', result.segments.map(s => s.text).join(' '));
  } catch (err) {
    console.error(err);
  }
});

function createWindow () {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  })

  win.loadFile('index.html')
}

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})