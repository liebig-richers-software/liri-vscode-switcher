# CLAUDE.md

## Project overview

VSCode Switcher is a Windows-only Electron app — a slim always-on-top sidebar that lets the user switch between multiple VS Code windows via click or global hotkey. It calls Win32 APIs directly via [koffi](https://koffi.dev/) (no PowerShell, no shell spawning).

## Tech stack

- **Electron 28** — app shell
- **koffi** — Win32 FFI (no native addon compilation needed)
- **pnpm** — package manager
- **electron-builder** — NSIS installer packaging

## Key files

```
src/
  main.js          — Electron main process: Win32 API, window management, IPC, config, tray
  preload.js       — Exposes safe IPC bridge to sidebar renderer
  index.html       — Sidebar UI (vanilla JS, no framework)
  config.html      — Config UI window
  config-preload.js — IPC bridge for config window
config.json        — Default config, copied to userData on first launch
```

## Dev commands

```bash
pnpm start        # Run in dev mode (with hot-reload for HTML/CSS/JS changes)
pnpm run build    # Build NSIS installer → dist/
```

Hot-reload in dev mode watches `src/` and reloads renderer windows on any `.html/.css/.js` change (except `main.js`).

## Architecture

The sidebar window is `focusable: false` and uses `setIgnoreMouseEvents(true, {forward:true})` so it never steals focus from the editor. Mouse events are only enabled while the sidebar is visible (cursor at screen edge triggers show; after leaving, a 500ms timer hides it again).

Window state polling runs every 500ms via `setInterval` — it enumerates visible windows, matches them against the project config, and sends the result to the renderer via IPC.

Config is stored in `app.getPath("userData")/config.json`. The default config at `config.json` (project root) is copied on first launch.

## Win32 integration

All Win32 calls are in `src/main.js`. Key functions:
- `focusWindowByTitle(fragment)` — finds a window by title substring and brings it to front using the `AttachThreadInput` trick to bypass focus-stealing prevention
- `findWindowByTitle(fragment)` — iterates visible windows via `EnumWindows` callback
- `getWindowState()` — returns which configured projects are open and any unconfigured VS Code windows

## Known gotchas

**Windows Defender / build lock:** `pnpm run build` creates `dist/win-unpacked/resources/app.asar` which Defender scans immediately on creation. If the build fails with `The process cannot access the file because it is being used by another process`, wait a few seconds for Defender to finish and retry. Adding the `dist/` folder to Defender exclusions (requires admin) prevents this permanently.
