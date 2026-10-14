const { app, BrowserWindow, ipcMain, globalShortcut, screen, Tray, Menu, nativeImage, dialog } = require("electron");
const { exec } = require("child_process");
const path = require("path");
const fs = require("fs");
const koffi = require("koffi");

let mainWindow;
let configWindow = null;
let launcherWindow = null;
let tray;
let config;
let barHeight;

// ── Win32 API ─────────────────────────────────────────────────────────────────

const user32 = koffi.load("user32.dll");
const kernel32 = koffi.load("kernel32.dll");
const dwmapi = koffi.load("dwmapi.dll");

const WNDENUMPROC = koffi.proto("bool __stdcall WNDENUMPROC(void* hWnd, void* lParam)");

const _EnumWindows = user32.func("bool    __stdcall EnumWindows(WNDENUMPROC* lpEnumFunc, void* lParam)");
const _IsWindowVisible = user32.func("bool    __stdcall IsWindowVisible(void* hWnd)");
const _GetWindowTextW = user32.func("int     __stdcall GetWindowTextW(void* hWnd, void* lpString, int nMaxCount)");
const _SetForegroundWindow = user32.func("bool    __stdcall SetForegroundWindow(void* hWnd)");
const _BringWindowToTop = user32.func("bool    __stdcall BringWindowToTop(void* hWnd)");
const _ShowWindow = user32.func("bool    __stdcall ShowWindow(void* hWnd, int nCmdShow)");
const _IsIconic = user32.func("bool    __stdcall IsIconic(void* hWnd)");
const _GetForegroundWindow = user32.func("void*   __stdcall GetForegroundWindow()");
const _GetWindowThreadProcessId = user32.func(
    "uint32 __stdcall GetWindowThreadProcessId(void* hWnd, void* lpdwProcessId)",
);
const _AttachThreadInput = user32.func(
    "bool    __stdcall AttachThreadInput(uint32 idAttach, uint32 idAttachTo, bool fAttach)",
);
const _GetCurrentThreadId = kernel32.func("uint32 __stdcall GetCurrentThreadId()");
const _GetWindowRect = user32.func("bool    __stdcall GetWindowRect(void* hWnd, _Out_ void* lpRect)");
const _GetWindowLongW = user32.func("int32   __stdcall GetWindowLongW(void* hWnd, int nIndex)");
const _DwmGetWindowAttribute = dwmapi.func(
    "int32   __stdcall DwmGetWindowAttribute(void* hWnd, uint32 dwAttribute, _Out_ void* pvAttribute, uint32 cbAttribute)",
);

const DWMWA_CLOAKED = 14;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x00000080;

// Reused across isRealWindow() calls — it runs once per window on every 500ms
// poll, so per-call Buffer.alloc would only create GC churn. Enumeration is
// synchronous and single-threaded, so sharing these is safe.
const _cloakedBuf = Buffer.alloc(4);
const _rectBuf = Buffer.alloc(16);

function getWindowTitle(hwnd) {
    const buf = Buffer.alloc(1024);
    const len = _GetWindowTextW(hwnd, buf, 512);
    if (len <= 0) return "";
    return buf.slice(0, len * 2).toString("utf16le");
}

// Filter out phantom windows that pass IsWindowVisible but aren't real top-level
// app windows — most notably Chromium's DWM-cloaked "Jump List" helper window,
// which VS Code/Electron create and which would otherwise show as a ghost entry.
function isRealWindow(hwnd) {
    // DWM-cloaked: visible to EnumWindows but not actually rendered.
    if (_DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, _cloakedBuf, 4) === 0 && _cloakedBuf.readUInt32LE(0) !== 0) {
        return false;
    }

    // Tool windows never represent a normal editor window.
    const exStyle = _GetWindowLongW(hwnd, GWL_EXSTYLE) >>> 0;
    if (exStyle & WS_EX_TOOLWINDOW) return false;

    // Zero-area windows are helper/message windows, not real UI.
    if (!_GetWindowRect(hwnd, _rectBuf)) return false;
    const width = _rectBuf.readInt32LE(8) - _rectBuf.readInt32LE(0);
    const height = _rectBuf.readInt32LE(12) - _rectBuf.readInt32LE(4);
    if (width <= 0 || height <= 0) return false;

    return true;
}

// Enumerate top-level windows, invoking visit(hwnd) for each. Return false from
// visit to stop early (mirrors the Win32 EnumWindows contract); any other value
// continues. The koffi callback is always unregistered, even if enumeration
// throws — otherwise the callback pool slowly fills up and crashes the process.
function enumWindows(visit) {
    const cb = koffi.register((hwnd, _lParam) => visit(hwnd) !== false, koffi.pointer(WNDENUMPROC));
    try {
        _EnumWindows(cb, null);
    } finally {
        koffi.unregister(cb);
    }
}

// VS Code titles read "<editor> - <workspace> - Visual Studio Code" (the editor
// part is missing when nothing is open). Only the workspace part identifies the
// project — a whole-title match lets an open file like "nsi-core-notes.md" claim
// the nsi-architecture window for nsi-core.
function titleMatches(title, fragment) {
    const m = title.match(/^(.*)\s[—–-]\s*Visual Studio Code/);
    if (!m) return false;
    const parts = m[1].split(/\s[—–-]\s/);
    return parts.slice(parts.length > 1 ? 1 : 0).some((part) => part.includes(fragment));
}

function findProjectIdByTitle(title) {
    return config.projects.find((p) => titleMatches(title, p.windowTitle))?.id ?? null;
}

function findWindowByTitle(fragment) {
    let found = null;
    enumWindows((hwnd) => {
        if (!_IsWindowVisible(hwnd) || !isRealWindow(hwnd)) return;
        const title = getWindowTitle(hwnd);
        if (titleMatches(title, fragment)) {
            found = hwnd;
            return false; // stop enumeration
        }
    });
    return found;
}

function focusWindowByTitle(titleFragment) {
    const hwnd = findWindowByTitle(titleFragment);
    if (!hwnd) return { success: false, reason: "notfound" };

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

// ── Window state polling ───────────────────────────────────────────────────────

function calcBarHeight(pinnedCount, unpinnedCount = 0) {
    const hasDivider = pinnedCount > 0 && unpinnedCount > 0;
    return (
        12 + 36 + 8 + 9 // top chrome: padding + logo + logo-margin + divider
        + pinnedCount * 52 + Math.max(0, pinnedCount - 1) * 6
        + (hasDivider ? 9 : 0)
        + unpinnedCount * 52 + Math.max(0, unpinnedCount - 1) * 6
        + 8 + 36 + 8 // bottom chrome: settings-margin + settings + padding
    );
}

function getWindowState() {
    const visibleTitles = [];
    enumWindows((hwnd) => {
        if (!_IsWindowVisible(hwnd) || !isRealWindow(hwnd)) return;
        const title = getWindowTitle(hwnd);
        if (title) visibleTitles.push(title);
    });

    const openIds = config.projects
        .filter((p) => visibleTitles.some((t) => titleMatches(t, p.windowTitle)))
        .map((p) => p.id);

    const unpinnedWindows = visibleTitles
        .filter((t) => t.includes("Visual Studio Code") && !findProjectIdByTitle(t))
        .map((t) => ({ title: t }));

    return { openIds, unpinnedWindows };
}

function checkActiveWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    // Guard the whole tick: a transient Win32/FFI failure must never bubble up
    // out of setInterval, where it would become an uncaught exception and kill
    // the app silently.
    try {
        const hwnd = _GetForegroundWindow();
        const title = hwnd ? getWindowTitle(hwnd) : "";
        const { openIds, unpinnedWindows } = getWindowState();

        const cursor = screen.getCursorScreenPoint();
        const [wx, wy] = mainWindow.getPosition();
        const [ww, wh] = mainWindow.getSize();
        const cursorInWindow = cursor.x >= wx && cursor.x < wx + ww && cursor.y >= wy && cursor.y < wy + wh;
        const cursorAtEdge = cursor.x === 0 && cursor.y >= wy && cursor.y < wy + wh;

        const activeId = findProjectIdByTitle(title);
        mainWindow.webContents.send("active-window", { activeId, openIds, unpinnedWindows, cursorInWindow, cursorAtEdge });

        if (launcherWindow && !launcherWindow.isDestroyed()) {
            launcherWindow.webContents.send("active-window", { openIds });
        }
    } catch (e) {
        console.error("checkActiveWindow failed:", e);
    }
}

// ── Config ────────────────────────────────────────────────────────────────────

function loadConfig() {
    const configPath = path.join(app.getPath("userData"), "config.json");
    const defaultConfigPath = path.join(__dirname, "..", "config.json");

    if (!fs.existsSync(configPath)) {
        fs.copyFileSync(defaultConfigPath, configPath);
    }

    try {
        config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    } catch (e) {
        console.error("Failed to load config, using defaults:", e);
        config = JSON.parse(fs.readFileSync(defaultConfigPath, "utf-8"));
    }
    return config;
}

function getConfigPath() {
    return path.join(app.getPath("userData"), "config.json");
}

// ── Create sidebar window ─────────────────────────────────────────────────────

function createWindow() {
    const display = screen.getPrimaryDisplay();
    const { height: screenHeight } = display.workAreaSize;

    const barWidth = config.width || 72;
    barHeight = calcBarHeight(config.projects.length);

    // Note: don't clamp against initial `barHeight` — it overestimates, since the
    // sidebar now only shows open projects. The `resize-window` handler re-clamps
    // after the renderer measures actual height.
    let clampedY;
    if (config.barY != null) {
        clampedY = Math.max(0, Math.min(config.barY, screenHeight - 40));
    } else {
        const offsetY = config.barOffsetY ?? 0;
        clampedY = Math.max(0, Math.min(Math.round(screenHeight * offsetY - barHeight / 2), screenHeight - barHeight));
    }

    mainWindow = new BrowserWindow({
        width: barWidth,
        height: barHeight,
        x: 0,
        y: clampedY,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        focusable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "preload.js"),
        },
    });

    mainWindow.loadFile(path.join(__dirname, "index.html"));
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
}

// ── Create config window ──────────────────────────────────────────────────────

function createConfigWindow(prefill = null) {
    if (configWindow && !configWindow.isDestroyed()) {
        configWindow.focus();
        if (prefill) configWindow.webContents.send("prefill-project", prefill);
        return;
    }

    configWindow = new BrowserWindow({
        width: 720,
        height: 620,
        title: "VSCode Switcher — Configure",
        resizable: true,
        backgroundColor: "#0d0d12",
        titleBarStyle: "hidden",
        titleBarOverlay: {
            color: "#0d0d12",
            symbolColor: "#ffffff",
            height: 48,
        },
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "config-preload.js"),
        },
    });

    configWindow.loadFile(path.join(__dirname, "config.html"));
    configWindow.on("closed", () => {
        configWindow = null;
    });

    if (prefill) {
        configWindow.webContents.once("did-finish-load", () => {
            configWindow.webContents.send("prefill-project", prefill);
        });
    }
}

// ── Create launcher window ────────────────────────────────────────────────────

function createLauncherWindow() {
    if (launcherWindow && !launcherWindow.isDestroyed()) {
        launcherWindow.focus();
        return;
    }

    const barWidth = config.width || 72;
    const [, wy] = mainWindow.getPosition();
    const display = screen.getPrimaryDisplay();
    const { width: screenWidth, height: screenHeight } = display.workAreaSize;

    const launcherWidth = 360;
    const launcherHeight = Math.min(480, screenHeight - 20);
    const gap = 4;
    const x = Math.min(barWidth + gap, screenWidth - launcherWidth);
    const y = Math.max(10, Math.min(wy, screenHeight - launcherHeight - 10));

    launcherWindow = new BrowserWindow({
        width: launcherWidth,
        height: launcherHeight,
        x, y,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        resizable: false,
        movable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, "launcher-preload.js"),
        },
    });

    launcherWindow.loadFile(path.join(__dirname, "launcher.html"));
    launcherWindow.on("blur", () => {
        if (launcherWindow && !launcherWindow.isDestroyed()) launcherWindow.close();
    });
    launcherWindow.on("closed", () => { launcherWindow = null; });
}

// ── Tray ──────────────────────────────────────────────────────────────────────

function buildTrayMenu() {
    const openAtLogin = app.getLoginItemSettings().openAtLogin;
    tray.setContextMenu(
        Menu.buildFromTemplate([
            { label: "Configure", click: () => createConfigWindow() },
            {
                label: "Reload Config",
                click: () => {
                    loadConfig();
                    mainWindow.webContents.send("config-updated", config);
                    registerHotkeys();
                },
            },
            { type: "separator" },
            {
                label: "Start with Windows",
                type: "checkbox",
                checked: openAtLogin,
                click: () => {
                    app.setLoginItemSettings({ openAtLogin: !openAtLogin });
                    buildTrayMenu();
                },
            },
            { type: "separator" },
            { label: "Quit", click: () => app.quit() },
        ]),
    );
}

function makeTrayIconBuffer() {
    const zlib = require("zlib");

    function crc32(buf) {
        const table = [];
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c;
        }
        let crc = 0xffffffff;
        for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
        return (crc ^ 0xffffffff) >>> 0;
    }

    function chunk(type, data) {
        const typeBytes = Buffer.from(type, "ascii");
        const len = Buffer.alloc(4);
        len.writeUInt32BE(data.length);
        const crcInput = Buffer.concat([typeBytes, data]);
        const crcBuf = Buffer.alloc(4);
        crcBuf.writeUInt32BE(crc32(crcInput));
        return Buffer.concat([len, typeBytes, data, crcBuf]);
    }

    // IHDR: 16×16, 8-bit RGBA
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(16, 0);
    ihdr.writeUInt32BE(16, 4);
    ihdr[8] = 8; ihdr[9] = 6; // bit depth, color type RGBA

    // Draw a simple ">" arrow icon: VS Code blue bg, white chevron
    const rows = [];
    for (let y = 0; y < 16; y++) {
        const row = Buffer.alloc(65); // filter byte + 16 RGBA pixels
        for (let x = 0; x < 16; x++) {
            const mid = 7.5, half = Math.abs(y - mid);
            const onChevron = (x === Math.round(4 + half) || x === Math.round(4 + half - 1)) && half <= 6;
            const i = 1 + x * 4;
            if (onChevron) {
                row[i] = 0xff; row[i + 1] = 0xff; row[i + 2] = 0xff; row[i + 3] = 0xff;
            } else {
                row[i] = 0x00; row[i + 1] = 0x7a; row[i + 2] = 0xcc; row[i + 3] = 0xff;
            }
        }
        rows.push(row);
    }
    const compressed = zlib.deflateSync(Buffer.concat(rows));

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk("IHDR", ihdr),
        chunk("IDAT", compressed),
        chunk("IEND", Buffer.alloc(0)),
    ]);
}

function createTray() {
    const img = nativeImage.createFromBuffer(makeTrayIconBuffer());
    tray = new Tray(img);
    tray.setToolTip("VSCode Switcher");
    buildTrayMenu();
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
                    mainWindow.webContents.send("focus-result", { id: project.id, ...result });
                }
            });
        } catch (e) {
            console.warn(`Could not register hotkey ${project.hotkey}:`, e.message);
        }
    });
}

// ── IPC Handlers ──────────────────────────────────────────────────────────────

ipcMain.handle("get-config", () => config);

ipcMain.handle("focus-project", (_, projectId) => {
    const project = config.projects.find((p) => p.id === projectId);
    if (!project) return { success: false, reason: "Project not found" };
    return focusWindowByTitle(project.windowTitle);
});

ipcMain.handle("focus-window-by-title", (_, title) => focusWindowByTitle(title));

ipcMain.handle("launch-project", (_, projectId) => {
    const project = config.projects.find((p) => p.id === projectId);
    if (!project?.path) return { success: false, reason: "no path configured" };
    exec(`code "${project.path}"`, (err) => {
        if (err) console.warn("Failed to launch VS Code:", err.message);
    });
    return { success: true };
});

ipcMain.handle("open-config-window", (_, prefill) => createConfigWindow(prefill ?? null));

ipcMain.handle("open-launcher-window", () => createLauncherWindow());

ipcMain.on("close-launcher-window", () => launcherWindow?.close());

ipcMain.handle("save-config", (_, newConfig) => {
    // Preserve runtime-managed window position — the config UI carries a stale
    // snapshot from when it opened, and shouldn't clobber later drags.
    config = { ...newConfig, barY: config.barY };
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
    registerHotkeys();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("config-updated", config);
    if (configWindow && !configWindow.isDestroyed()) configWindow.webContents.send("config-updated", config);
    if (launcherWindow && !launcherWindow.isDestroyed()) launcherWindow.webContents.send("config-updated", config);
    return { success: true };
});

ipcMain.on("set-ignore-mouse", (_, ignore) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setIgnoreMouseEvents(ignore, { forward: true });
    }
});

ipcMain.on("move-to-top", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.moveTop();
    }
});

ipcMain.on("move-window", (_, y) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const { height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const barWidth = config.width || 72;
    const clampedY = Math.max(0, Math.min(y, screenHeight - barHeight));
    mainWindow.setBounds({ x: 0, y: clampedY, width: barWidth, height: barHeight });
});

ipcMain.on("save-window-y", (_, y) => {
    config.barY = y;
    fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
});

ipcMain.on("resize-window", (_, height) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const { height: screenHeight } = screen.getPrimaryDisplay().workAreaSize;
    const barWidth = config.width || 72;
    const [, wy] = mainWindow.getPosition();
    const clampedY = Math.max(0, Math.min(wy, screenHeight - height));
    barHeight = height;
    mainWindow.setBounds({ x: 0, y: clampedY, width: barWidth, height });
});

ipcMain.on("close-config-window", () => configWindow?.close());

ipcMain.handle("select-folder", async () => {
    const result = await dialog.showOpenDialog(configWindow, {
        properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("check-active-window", () => {
    const hwnd = _GetForegroundWindow();
    const title = hwnd ? getWindowTitle(hwnd) : "";
    const { openIds, unpinnedWindows } = getWindowState();
    return { activeId: findProjectIdByTitle(title), openIds, unpinnedWindows };
});

// ── App Lifecycle ─────────────────────────────────────────────────────────────

// Last-resort safety net: keep the tray app alive on stray errors instead of
// vanishing without a trace. Anything reaching here is a bug worth logging.
process.on("uncaughtException", (e) => console.error("uncaughtException:", e));
process.on("unhandledRejection", (e) => console.error("unhandledRejection:", e));

const isDev = !app.isPackaged;

// In dev we want several instances side by side for testing. Give each its own
// cache dir so they don't fight over the shared Chromium cache ("Unable to move
// the cache: Access is denied") — config in userData stays shared, so every
// instance still sees the real projects.
if (isDev) {
    app.setPath("sessionData", path.join(app.getPath("temp"), `vscode-switcher-session-${process.pid}`));
}

// A packaged build runs single-instance: a second launch would double-register
// the global hotkeys, so just resurface the running one instead.
const hasLock = isDev || app.requestSingleInstanceLock();

if (!hasLock) {
    app.quit();
} else {
    if (!isDev) {
        app.on("second-instance", () => {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.show();
        });
    }

    app.whenReady().then(() => {
        loadConfig();
        createWindow();
        createTray();
        registerHotkeys();

        setInterval(checkActiveWindow, 500);

        // ── Dev: hot-reload renderer on HTML/CSS/JS changes ───────────────────
        if (!app.isPackaged) {
            const { watch } = require("fs");
            watch(__dirname, (_, filename) => {
                if (!filename || !/\.(html|css|js)$/.test(filename) || filename === "main.js") return;
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload();
                if (configWindow && !configWindow.isDestroyed()) configWindow.webContents.reload();
                if (launcherWindow && !launcherWindow.isDestroyed()) launcherWindow.webContents.reload();
            });
        }
    });
}

app.on("will-quit", () => {
    globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
    // Keep running even if window is closed (tray app)
});
