'use strict';

const { app, BrowserWindow, shell, dialog, Menu } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');
const { pathToFileURL } = require('url');

const PORT = 4080;

// Enforce single instance — second launch focuses the existing window
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Windows taskbar grouping
app.setAppUserModelId('com.opencode.claudecode');

// With asar:false, __dirname is always <app>/electron/ in both dev and packaged
function getPath(...parts) {
  return path.join(__dirname, '..', ...parts);
}

// Persist window size/position across launches
const windowStatePath = path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(windowStatePath, 'utf8'));
  } catch {
    return { width: 1400, height: 900 };
  }
}

function saveWindowState(win) {
  if (win.isMaximized() || win.isMinimized() || win.isFullScreen()) return;
  try {
    fs.writeFileSync(windowStatePath, JSON.stringify(win.getBounds()), 'utf8');
  } catch {}
}

function pollHealth(timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    function attempt() {
      const req = http.get(`http://localhost:${PORT}/health`, { timeout: 1000 }, (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else schedule();
      });
      req.on('timeout', () => { req.destroy(); });
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

function buildMenu() {
  if (process.platform === 'darwin') {
    return Menu.buildFromTemplate([
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
          { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          ...(!app.isPackaged ? [{ role: 'toggleDevTools' }] : []),
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] },
    ]);
  }
  // Windows / Linux: no menu bar in production
  return app.isPackaged ? null : Menu.buildFromTemplate([
    {
      label: 'View',
      submenu: [{ role: 'reload' }, { role: 'toggleDevTools' }],
    },
  ]);
}

function createWindow() {
  const state = loadWindowState();
  const win = new BrowserWindow({
    ...state,
    minWidth: 800,
    minHeight: 600,
    title: 'OpenCode',
    backgroundColor: '#0f0f10',
    show: false, // reveal only after first paint to eliminate white flash
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      devTools: !app.isPackaged,
    },
  });

  // Show once the first frame is ready
  win.once('ready-to-show', () => win.show());

  // Focus existing window when user tries to open a second instance
  app.on('second-instance', () => {
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  // Block popup windows; route http/https links to system browser (RCE guard)
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        shell.openExternal(url);
      }
    } catch {}
    return { action: 'deny' };
  });

  // Block in-page navigation away from the local server
  win.webContents.on('will-navigate', (event, url) => {
    try {
      const parsed = new URL(url);
      const isLocal = parsed.hostname === 'localhost' && parsed.port === String(PORT);
      if (!isLocal) {
        event.preventDefault();
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          shell.openExternal(url);
        }
      }
    } catch {
      event.preventDefault();
    }
  });

  win.on('close', () => saveWindowState(win));

  return win;
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(buildMenu());

  let win;
  try {
    win = createWindow();
    // Show loading screen immediately — user sees something while server boots
    win.loadFile(path.join(__dirname, 'loading.html'));

    const serverEntry = getPath('dist-cli', 'server.js');
    const staticDir = getPath('dist');
    const { startServer } = await import(pathToFileURL(serverEntry).href);
    await startServer({ port: PORT, staticDir, noPassword: true });
    await pollHealth();

    win.loadURL(`http://localhost:${PORT}`);
  } catch (err) {
    console.error('[OpenCode] Failed to start:', err);
    if (win) win.destroy();
    dialog.showErrorBox(
      'OpenCode — Startup Failed',
      `The OpenCode server could not start.\n\n${err.message}\n\nMake sure port ${PORT} is not already in use and try again.`,
    );
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    // On macOS re-activate: server is already running, go straight to the app
    const win = createWindow();
    win.loadURL(`http://localhost:${PORT}`);
  }
});
