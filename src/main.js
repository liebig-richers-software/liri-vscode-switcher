const { app, BrowserWindow, ipcMain, globalShortcut, screen, Tray, Menu, nativeImage } = require('electron');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

let mainWindow;
let tray;
let config;
let checkingActiveWindow = false;

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

// ── Window Focus (PowerShell) ─────────────────────────────────────────────────

function focusWindowByTitle(titleFragment) {
  // Uses PowerShell to find and focus any window whose title contains the fragment
  const script = `
    Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      public class Win32 {
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
      }
"@
    $procs = Get-Process | Where-Object { $_.MainWindowTitle -like '*${titleFragment}*' -and $_.MainWindowHandle -ne 0 }
    if ($procs) {
      $hwnd = $procs[0].MainWindowHandle
      if ([Win32]::IsIconic($hwnd)) { [Win32]::ShowWindow($hwnd, 9) }
      [Win32]::SetForegroundWindow($hwnd)
      Write-Output "focused:$($procs[0].MainWindowTitle)"
    } else {
      Write-Output "notfound"
    }
  `;

  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve) => {
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, (err, stdout) => {
      if (err) { resolve({ success: false, reason: err.message }); return; }
      const out = stdout.trim();
      resolve({ success: out.startsWith('focused:'), title: out });
    });
  });
}

// ── Window focused state polling ──────────────────────────────────────────────

function checkActiveWindow() {
  if (!mainWindow || mainWindow.isDestroyed() || checkingActiveWindow) return;
  checkingActiveWindow = true;

  const script = `(Get-Process | Where-Object { $_.MainWindowHandle -eq (Add-Type -PassThru -Name 'FG' -MemberDefinition '[DllImport(""user32.dll"")] public static extern IntPtr GetForegroundWindow();' )::GetForegroundWindow() }).MainWindowTitle`;

  exec(`powershell -NoProfile -NonInteractive -Command "${script}"`, (err, stdout) => {
    checkingActiveWindow = false;
    if (!err && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('active-window', stdout.trim());
    }
  });
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

  // Allow click-through on transparent areas but capture button clicks
  mainWindow.setIgnoreMouseEvents(false);
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
      globalShortcut.register(project.hotkey, async () => {
        const result = await focusWindowByTitle(project.windowTitle);
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

ipcMain.handle('focus-project', async (_, projectId) => {
  const project = config.projects.find(p => p.id === projectId);
  if (!project) return { success: false, reason: 'Project not found' };
  return focusWindowByTitle(project.windowTitle);
});

ipcMain.handle('open-config', () => {
  exec(`explorer "${getConfigPath()}"`);
});

ipcMain.handle('check-active-window', async () => {
  return new Promise((resolve) => {
    const script = `
      Add-Type -Name 'FG' -Namespace '' -MemberDefinition '[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();' -ErrorAction SilentlyContinue
      $hwnd = [FG]::GetForegroundWindow()
      $proc = Get-Process | Where-Object { $_.MainWindowHandle -eq $hwnd } | Select-Object -First 1
      Write-Output $proc.MainWindowTitle
    `;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    exec(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, (err, stdout) => {
      resolve(stdout.trim());
    });
  });
});

// ── App Lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  loadConfig();
  createWindow();
  createTray();
  registerHotkeys();

  // Poll active window every 1500ms to highlight active project
  setInterval(checkActiveWindow, 1500);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Keep running even if window is closed (tray app)
});
