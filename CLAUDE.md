# CLAUDE.md

## Project overview

VSCode Switcher is a Windows-only Electron app — a slim always-on-top sidebar that lets the user switch between multiple VS Code windows via click or global hotkey. It calls Win32 APIs directly via [koffi](https://koffi.dev/) (no PowerShell, no shell spawning).

## Tech stack

- **Electron 28** — app shell
- **koffi** — Win32 FFI (no native addon compilation needed)
- **pnpm** — package manager
- **electron-builder** — NSIS installer packaging
- **Material Symbols Outlined** — icon font (loaded from Google Fonts at runtime)

## Key files

```
src/
  main.js             — Electron main process: Win32 API, window management, IPC, config, tray, launcher
  preload.js          — Exposes safe IPC bridge to sidebar renderer
  index.html          — Sidebar UI (vanilla JS, no framework)
  config.html         — Config UI window (frameless, native overlay controls)
  config-preload.js   — IPC bridge for config window
  launcher.html       — Launcher popup shown when clicking an inactive project
  launcher-preload.js — IPC bridge for launcher popup
config.json           — Default config, copied to userData on first launch
```

## Dev commands

```bash
pnpm dev          # Run in dev mode — watches src/ and reloads renderer on .html/.css/.js changes (not main.js)
pnpm run build    # Build NSIS installer → dist/
```

## Architecture

The sidebar window is `focusable: false` and uses `setIgnoreMouseEvents(true, {forward:true})` so it never steals focus from the editor. Mouse events are only enabled while the sidebar is visible (cursor at screen edge triggers show; after leaving, a 500ms timer hides it again).

Window state polling runs every 500ms via `setInterval` — it enumerates visible windows, matches them against the project config, and sends the result to the renderer via IPC.

Config is stored in `app.getPath("userData")/config.json`. The default config at `config.json` (project root) is copied on first launch.

## Icon system

Icons are stored in `config.json` per project as either:
- A **Material Symbol name** (e.g. `"folder"`, `"receipt_long"`) — rendered via the Material Symbols Outlined font
- A legacy **emoji character** — still supported for backwards compatibility

Detection via `isSymbolName(icon)`: returns true if the value matches `/^[a-z][a-z0-9_]*$/`.

The icon picker in `config.html` shows a searchable grid of Material Symbol icons with German/English keyword search. The `ICONS` array contains `[name, keywords]` tuples. Each project's icon color in the sidebar uses `--project-color` (the project's accent color).

## Config UI

- Frameless window: `titleBarStyle: "hidden"` + `titleBarOverlay` for native minimize/close controls on a custom dark title bar
- Per-project fields: icon, label, group (optional), window title fragment, folder path (optional), accent color, optional hotkey
- Group autocomplete is fed by a `<datalist>` built from existing group names
- Folder path triggers `code "<path>"` via `exec` when clicking an inactive project
- **Autostart with Windows** toggle: writes/removes the app under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
- Save writes to `userData/config.json` and triggers a live update in the sidebar and launcher via IPC

## Launcher popup

- Opened from the sidebar when the user clicks an inactive project (no matching VS Code window open)
- Lives in `launcher.html` / `launcher-preload.js`; created via `createLauncherWindow()` in `main.js`
- Positioned next to the sidebar; auto-closes on blur
- Lists all projects that have a `path` configured; clicking one launches VS Code and closes the popup

## Project grouping & sidebar position

- `group` field on each project — projects sharing the same group are rendered as a visual cluster in the sidebar; ungrouped projects sit on their own
- `barOffsetY` (0…1) in `config.json` stores the sidebar's vertical center as a fraction of screen height — updated when the user drags the bar, preserved across restarts
- The in-memory runtime position takes precedence over whatever the config UI last sent (see the comment at the `preserve runtime-managed window position` guard in `main.js`)

## Win32 integration

All Win32 calls are in `src/main.js`. Key functions:
- `focusWindowByTitle(fragment)` — finds a window by title substring and brings it to front using the `AttachThreadInput` trick to bypass focus-stealing prevention
- `findWindowByTitle(fragment)` — iterates visible windows via `EnumWindows` callback
- `getWindowState()` — returns which configured projects are open and any unconfigured VS Code windows

## Tray icon

Generated programmatically at startup via `makeTrayIconBuffer()` in `main.js` — builds a valid PNG in memory using Node's `zlib.deflateSync` and a hand-rolled CRC32. No external asset file needed.

