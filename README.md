# VSCode Switcher

A slim, always-on-top sidebar for Windows that lets you switch between multiple VS Code windows instantly — via click or global hotkey.

## Features

- **Auto-hide sidebar** — slides in when the cursor touches the left screen edge, hides after leaving
- **Global hotkeys** — jump to any project window without touching the mouse
- **Tray icon** — runs in the background, accessible from the system tray
- **Unpinned window detection** — unknown VS Code windows appear with a dashed border; click the pin to add them to the config
- **Material Symbols icons** — modern, monochromatic icon font with searchable picker (200+ icons)
- **Per-project accent colors** — each project button glows in its own color
- **Drag-to-reorder** — reorder projects in the config by dragging the grip handle

## Tech stack

- [Electron 28](https://www.electronjs.org/)
- [koffi](https://koffi.dev/) — Win32 FFI without native addon compilation
- [Material Symbols Outlined](https://fonts.google.com/icons) — icon font
- [electron-builder](https://www.electron.build/) — NSIS installer

## Getting started

**Requirements:** Windows, Node.js, pnpm

```bash
pnpm install
pnpm dev          # dev mode with hot-reload
pnpm run build    # build NSIS installer → dist/
```

## Configuration

Click the ⚙ button at the bottom of the sidebar to open the config window.

| Field | Description |
|---|---|
| Icon | Material Symbol — click to open the searchable picker |
| Label | Short name shown below the icon |
| Window Title | Substring matched against the VS Code window title |
| Color | Accent color for the button and icon |
| Hotkey | Optional global hotkey, e.g. `Alt+1` |

Projects can be reordered by dragging the grip handle on the left of each row.

Config is saved to `%APPDATA%\vscode-switcher\config.json`.

## How window matching works

VS Code window titles follow the pattern:
```
<file> — <project> — Visual Studio Code
```

Set **Window Title** to any unique substring of your project name. The app polls open windows every 500ms and highlights the currently focused one.

## Known issues

- **Build lock:** Windows Defender may hold `app.asar` open right after a build. Wait a few seconds and retry, or add `dist/` to Defender exclusions.
- **VS Code watcher lock:** If VS Code locks `app.asar` during a build, close VS Code completely before running `pnpm run build`. The `files.watcherExclude` setting in `.vscode/settings.json` requires a full restart to take effect.
