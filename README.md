# VSCode Switcher

A slim always-on-top sidebar for Windows that lets you instantly switch between multiple VS Code project windows via click or global hotkey.

Built for developers who work across 4–6 projects simultaneously and are tired of hunting through Alt+Tab or a bloated terminal list.

![VSCode Switcher Sidebar](./assets/screenshot.png)

## Features

- **Instant focus** — click a project button or press its hotkey to bring the right VS Code window to front, even if minimized
- **Active project highlight** — the current foreground window is automatically highlighted with a color accent
- **Auto-hide** — slides in from the left edge when you move the cursor to the screen edge, hides when you move away
- **Draggable** — grab the logo handle to reposition the sidebar vertically; position is persisted
- **Unpinned window detection** — unknown VS Code windows appear automatically with a pin button to add them to your config
- **Config UI** — built-in settings window to add/edit projects without touching JSON
- **Fully configurable** — labels, icons (emoji), colors, hotkeys, and window title patterns all in `config.json`
- **Always-on-top** — lives on the left edge of your screen, never gets buried
- **Tray icon** — reload config or open settings without restarting
- **Zero focus steal** — clicking the sidebar doesn't interfere with your editor focus

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/) 8+
- Windows 10/11

### Run from source

```bash
git clone https://github.com/yourname/vscode-switcher
cd vscode-switcher
pnpm install
pnpm start
```

### Build installer

```bash
pnpm run build
```

The NSIS installer will be in `dist/`.

> **Note on Windows Defender:** The build creates a large `app.asar` that Defender may scan and temporarily lock. If the build fails with a "file is being used by another process" error, wait a few seconds and retry.

## Configuration

On first launch, a `config.json` is created in your app data folder (`%APPDATA%\vscode-switcher\`). Click the ⚙ button in the sidebar or use the tray menu to open the config UI.

```json
{
  "width": 72,
  "barOffsetY": 0.5,
  "autostart": true,
  "projects": [
    {
      "id": "my-project",
      "label": "My App",
      "icon": "🚀",
      "color": "#3B82F6",
      "windowTitle": "my-project",
      "hotkey": "Alt+1"
    }
  ]
}
```

### Config fields

| Field | Description |
|---|---|
| `width` | Sidebar width in pixels (default: `72`) |
| `barOffsetY` | Vertical position as a fraction of screen height, `0.0` = top, `1.0` = bottom (default: `0.5`) |
| `barY` | Absolute Y position in pixels — set automatically when dragging, overrides `barOffsetY` |
| `autostart` | Launch automatically with Windows (default: `false`) |
| `projects[].id` | Unique identifier |
| `projects[].label` | Short display label (fits ~6 chars) |
| `projects[].icon` | Emoji icon |
| `projects[].color` | Accent color (hex) |
| `projects[].windowTitle` | Substring to match against window titles |
| `projects[].hotkey` | Global hotkey (e.g. `Alt+1`, `Ctrl+Shift+1`) |

### Finding the right `windowTitle`

VS Code window titles follow the pattern:
```
<active file> — <project name> — Visual Studio Code
```

Use the **project/workspace name** as your `windowTitle` value — it's matched as a substring so partial names work fine.

### Reload config

After editing `config.json` directly, use the tray menu → **Reload Config** — no restart needed. Changes via the config UI are applied immediately.

## How it works

Window focusing calls Win32 APIs (`EnumWindows`, `SetForegroundWindow`, `AttachThreadInput`) directly from the Electron main process via [koffi](https://koffi.dev/). No PowerShell spawning — instant and reliable across minimized windows, without elevated permissions.

## Roadmap

- [ ] macOS support (using `osascript`)
- [ ] Per-project custom tooltip with git branch
- [ ] Drag to reorder projects
- [ ] Multi-monitor support (pin to any screen edge)
- [ ] Auto-detect open VS Code windows

## License

MIT
