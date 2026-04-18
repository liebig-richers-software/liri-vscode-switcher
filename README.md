# VSCode Switcher

A slim, always-on-top sidebar for Windows that lets you switch between multiple VS Code windows instantly — via click or global hotkey.

## Features

- **Auto-hide sidebar** — slides in when the cursor touches the left screen edge, hides after leaving
- **Global hotkeys** — jump to any project window without touching the mouse
- **Launcher popup** — click an inactive project to open a launcher panel that starts VS Code with the configured folder
- **Project groups** — organize projects into named groups; grouped projects are visually separated in the sidebar
- **Persistent sidebar position** — drag the bar vertically; its position is remembered across restarts
- **Autostart with Windows** — optional, toggled from the config window
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
| Group | Optional group name — grouped projects are separated visually in the sidebar; autocomplete suggests existing groups |
| Window Title | Substring matched against the VS Code window title |
| Folder Path | Optional — when set, clicking an inactive project launches `code "<path>"` |
| Color | Accent color for the button and icon |
| Hotkey | Optional global hotkey, e.g. `Alt+1` |

Projects can be reordered by dragging the grip handle on the left of each row.
The **Autostart with Windows** toggle at the top of the config window registers the app in the Windows startup registry.

Config is saved to `%APPDATA%\vscode-switcher\config.json`.

## How window matching works

VS Code window titles follow the pattern:
```
<file> — <project> — Visual Studio Code
```

Set **Window Title** to any unique substring of your project name. The app polls open windows every 500ms and highlights the currently focused one.

## Known issues

- **Build lock:** If `pnpm run build` fails with `The process cannot access the file because it is being used by another process`, `app.asar` is being held open by a file watcher. The reliable workaround: do a fresh clone into a directory that no editor is watching, then run `pnpm install` and `pnpm run build` there.
