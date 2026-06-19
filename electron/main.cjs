'use strict';

const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const http = require('http');
const { pathToFileURL } = require('url');

const PORT = 4080;

function getPath(...parts) {
  // In a packaged app resources live next to the asar
  return app.isPackaged
    ? path.join(process.resourcesPath, ...parts)
    : path.join(__dirname, '..', ...parts);
}

function pollHealth(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      const req = http.get(`http://localhost:${PORT}/health`, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else schedule();
      });
      req.on('error', schedule);
      req.end();
    }
    function schedule() {
      if (Date.now() >= deadline) reject(new Error('Server startup timeout'));
      else setTimeout(attempt, 300);
    }
    attempt();
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'OpenCode',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  win.loadURL(`http://localhost:${PORT}`);
  // Open external links in system browser, not inside the Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(async () => {
  try {
    const serverEntry = getPath('dist-cli', 'server.js');
    const staticDir = getPath('dist');
    // pathToFileURL handles Windows drive-letter paths correctly
    const { startServer } = await import(pathToFileURL(serverEntry).href);
    startServer({ port: PORT, staticDir, noPassword: true });
    await pollHealth();
    createWindow();
  } catch (err) {
    console.error('[OpenCode] Failed to start:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
