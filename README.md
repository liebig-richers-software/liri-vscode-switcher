# VSCode Switcher

A slim always-on-top sidebar for Windows that lets you instantly switch between multiple VS Code project windows via click or global hotkey.

Built for developers who work across 4–6 projects simultaneously and are tired of hunting through Alt+Tab or a bloated terminal list.

![VSCode Switcher Sidebar](./assets/screenshot.png)

## Features

- **Instant focus** — click a project button or press its hotkey to bring the right VS Code window to front, even if minimized
- **Active project highlight** — the current foreground window is automatically highlighted with a color accent
- **Fully configurable** — labels, icons (emoji), colors, hotkeys, and window title patterns all in `config.json`
- **Always-on-top** — lives on the left edge of your screen, never gets buried
- **Tray icon** — open config or reload without restarting
- **Zero focus steal** — clicking the sidebar doesn't interfere with your editor focus

## Installation

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
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

The installer will be in `dist/`.

## Configuration

On first launch, a `config.json` is created in your app data folder. Click the ⚙ button in the sidebar or use the tray menu to open it.

```json
{
  "width": 72,
  "position": "left",
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
| `width` | Sidebar width in pixels (default: 72) |
| `position` | Sidebar position: `"left"` (default) |
| `autostart` | Launch automatically with Windows (default: `false`) |
| `projects[].id` | Unique identifier |
| `projects[].label` | Short display label (fits ~6 chars) |
| `projects[].icon` | Emoji icon |
| `projects[].color` | Accent color (hex) |
| `projects[].windowTitle` | Substring to match against window titles. VS Code windows include the folder/workspace name. |
| `projects[].hotkey` | Global hotkey (e.g. `Alt+1`, `Ctrl+Shift+1`) |

### Finding the right `windowTitle`

VS Code window titles follow the pattern:
```
<active file> - <project name> - Visual Studio Code
```

Use the **project/workspace name** as your `windowTitle` value — it's matched as a substring so partial names work fine.

### Reload config

After editing `config.json`, use the tray menu → **Reload Config** — no restart needed.

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
