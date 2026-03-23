const { app, BrowserWindow, ipcMain, globalShortcut, screen, Tray, Menu, nativeImage } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const koffi = require('koffi');

let mainWindow;
let tray;
let config;

// ── Win32 API ─────────────────────────────────────────────────────────────────

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const WNDENUMPROC = koffi.proto('bool __stdcall WNDENUMPROC(void* hWnd, void* lParam)');

const _EnumWindows           = user32.func('bool    __stdcall EnumWindows(WNDENUMPROC* lpEnumFunc, void* lParam)');
const _IsWindowVisible       = user32.func('bool    __stdcall IsWindowVisible(void* hWnd)');
const _GetWindowTextW        = user32.func('int     __stdcall GetWindowTextW(void* hWnd, void* lpString, int nMaxCount)');
const _SetForegroundWindow   = user32.func('bool    __stdcall SetForegroundWindow(void* hWnd)');
const _BringWindowToTop      = user32.func('bool    __stdcall BringWindowToTop(void* hWnd)');
const _ShowWindow            = user32.func('bool    __stdcall ShowWindow(void* hWnd, int nCmdShow)');
const _IsIconic              = user32.func('bool    __stdcall IsIconic(void* hWnd)');
const _GetForegroundWindow   = user32.func('void*   __stdcall GetForegroundWindow()');
const _GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(void* hWnd, void* lpdwProcessId)');
const _AttachThreadInput     = user32.func('bool    __stdcall AttachThreadInput(uint32 idAttach, uint32 idAttachTo, bool fAttach)');
const _GetCurrentThreadId    = kernel32.func('uint32 __stdcall GetCurrentThreadId()');

function getWindowTitle(hwnd) {
  const buf = Buffer.alloc(1024);
  const len = _GetWindowTextW(hwnd, buf, 512);
  if (len <= 0) return '';
  return buf.slice(0, len * 2).toString('utf16le');
}

function findWindowByTitle(fragment) {
  let found = null;
  const cb = koffi.register((hwnd, _lParam) => {
    if (!_IsWindowVisible(hwnd)) return true;
    const title = getWindowTitle(hwnd);
    if (title.includes(fragment)) {
      found = hwnd;
      return false; // stop enumeration
    }
    return true;
  }, koffi.pointer(WNDENUMPROC));
  _EnumWindows(cb, null);
  koffi.unregister(cb);
  return found;
}

function focusWindowByTitle(titleFragment) {
  const hwnd = findWindowByTitle(titleFragment);
  if (!hwnd) return { success: false, reason: 'notfound' };

  if (_IsIconic(hwnd)) _ShowWindow(hwnd, 9); // SW_RESTORE

  // AttachThreadInput trick: bypass Windows' focus-stealing prevention
  const fg = _GetForegroundWindow();
  const fgThread = fg ? _GetWindowThreadProcessId(fg, null) : 0;
  const myThread = _GetCurrentThreadId();
  if (fgThread && fgThread !== myThread) {
    _AttachThreadInput(myThread, fgThread, true);
    _SetForegroundWindow(hwnd);
    _BringWindowToTop(hwnd);
    _AttachThreadInput(myThread, fgThread, false);
  } else {
    _SetForegroundWindow(hwnd);
    _BringWindowToTop(hwnd);
  }

  return { success: true, title: `focused:${getWindowTitle(hwnd)}` };
}

// ── Window focused state polling ──────────────────────────────────────────────

function checkActiveWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const hwnd = _GetForegroundWindow();
  const title = hwnd ? getWindowTitle(hwnd) : '';
  mainWindow.webContents.send('active-window', title);
}

// ── Config ────────────────────────────────────────────────────────────────────

function loadConfig() {
  const configPath = path.join(app.getPath('userData'), 'config.json');
  const defaultConfigPath = path.join(__dirname, '..', 'config.json');

  // Copy default config to userData on first run
  if (!fs.existsSync(configPath)) {
    fs.copyFileSync(defaultConfigPath, configPath);
  }

  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    console.error('Failed to load config, using defaults:', e);
    config = JSON.parse(fs.readFileSync(defaultConfigPath, 'utf-8'));
  }
  return config;
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json');
}

// ── Create Window ─────────────────────────────────────────────────────────────

function createWindow() {
  const display = screen.getPrimaryDisplay();
  const { height } = display.workAreaSize;

  const barWidth = config.width || 72;

  mainWindow = new BrowserWindow({
    width: barWidth,
    height: height,
    x: 0,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,   // Don't steal focus on click
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });

  // Start with click-through; renderer toggles this on hover
  mainWindow.setIgnoreMouseEvents(true, { forward: true });
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function createTray() {
  // Minimal tray icon (1x1 transparent fallback if no icon file)
  const img = nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('VSCode Switcher');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Config', click: () => { exec(`explorer "${getConfigPath()}"`); } },
    { label: 'Reload Config', click: () => { loadConfig(); mainWindow.webContents.send('config-updated', config); registerHotkeys(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

// ── Global Hotkeys ────────────────────────────────────────────────────────────

function registerHotkeys() {
  globalShortcut.unregisterAll();

  config.projects.forEach((project) => {
    if (!project.hotkey) return;
    try {
      globalShortcut.register(project.hotkey, () => {
        const result = focusWindowByTitle(project.windowTitle);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('focus-result', { id: project.id, ...result });
        }
      });
    } catch (e) {
      console.warn(`Could not register hotkey ${project.hotkey}:`, e.message);
    }
  });
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.handle('get-config', () => config);

ipcMain.handle('focus-project', (_, projectId) => {
  const project = config.projects.find(p => p.id === projectId);
  if (!project) return { success: false, reason: 'Project not found' };
  return focusWindowByTitle(project.windowTitle);
});

ipcMain.handle('open-config', () => {
  exec(`explorer "${getConfigPath()}"`);
});

ipcMain.on('set-ignore-mouse', (_, ignore) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
  }
});

ipcMain.handle('check-active-window', () => {
  const hwnd = _GetForegroundWindow();
  return hwnd ? getWindowTitle(hwnd) : '';
});

// ── App Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  loadConfig();
  createWindow();
  createTray();
  registerHotkeys();

  // Poll active window every 500ms to highlight active project
  setInterval(checkActiveWindow, 500);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Keep running even if window is closed (tray app)
});
