# MusicCast Analyzer

A desktop app (Tauri 2, Rust, React + TypeScript) for diagnosing, linking and monitoring Yamaha MusicCast devices on a home network.

The UI is available in English (default) and German. The language is chosen in Settings and remembered across restarts.

## Requirements (Windows)

- Rust (stable, MSVC toolchain) and the Visual Studio C++ Build Tools
- Node.js 18 or newer
- WebView2 Runtime (usually present on Windows 10/11)

## Run and build

```powershell
npm install
npm run tauri dev      # development with hot reload
npm run tauri build    # release: src-tauri\target\release\musiccast-analyzer.exe and an NSIS installer
```

With `tauri-cli` installed (`cargo install tauri-cli --version "^2"`), `cargo tauri dev` and `cargo tauri build` work as well.
`npm install` is needed either way because the frontend is built with Vite.

`npm run typecheck` checks the TypeScript types separately. The build itself runs through Vite and does not stop on type errors.

## Features

- Pick a Wi-Fi adapter and scan the 2.4 GHz band through `netsh` (channel usage, recommendation for channel 1, 6 or 11)
- Find MusicCast devices (SSDP plus a sweep of the /24 subnet) or enter addresses manually
- Hints: weak signal, different access points, firmware versions, channel choice, MusicCast locations
- MusicCast Link: choose master and clients, link them, set the group name, unlink, power
- "Switch to wired": moves a device from Wi-Fi to cable through `system/setWiredLan`
- Move devices into one MusicCast location
- Background monitoring with a tray icon, a CSV log and Windows notifications on dropouts
- Native window menu with keyboard shortcuts, light and dark colour scheme
- Automatic update from GitHub releases

## Automatic update

The installed app checks the latest GitHub release (`latest.json`) on startup, downloads a newer
version, installs it and restarts. No check takes place in dev mode (`npm run tauri dev`).

Updates must be signed. One-time setup:

```powershell
npm run tauri signer generate -- -w "$HOME\.tauri\musiccast-analyzer.key"
```

- Put the printed public key into `src-tauri/tauri.conf.json` at `plugins.updater.pubkey`.
- In the GitHub repository, under Settings, Secrets and variables, Actions, create two secrets:
  `TAURI_SIGNING_PRIVATE_KEY` (the content of the `.key` file) and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- Keep the private key safe. If it is lost, installed apps can no longer accept updates.

A local `npm run tauri build` needs the same two values as environment variables.

## Releases

Pushing a tag such as `v0.2.0` runs `.github/workflows/release.yml`. The workflow takes the version
from the tag, writes it into the project files for that build, builds the app on Windows and creates
a GitHub release with the installer, a portable EXE and the update files.

## Languages

All UI text lives in `src/i18n.ts`; `de` must mirror the shape of `en`, which TypeScript enforces.
Text produced on the Rust side (native menus, notifications, error messages, step descriptions)
is chosen with `i18n::pick(en, de)` in `src-tauri/src/i18n.rs`. The CSV log is always written in English.

## Layout

| Path | Content |
| --- | --- |
| `src/App.tsx` | React UI: views, bottom panel, status bar |
| `src/i18n.ts` | English and German UI text |
| `src/logic.ts` | Hints, channel scoring, location helpers |
| `src/api.ts` | Calls into the Rust commands |
| `src-tauri/src/yxc.rs` | Yamaha Extended Control: status, link, power, setWiredLan, locations |
| `src-tauri/src/discovery.rs` | Device discovery |
| `src-tauri/src/wlan.rs` | Adapter list (PowerShell) and scan (netsh) |
| `src-tauri/src/monitor.rs` | Background monitoring |
| `src-tauri/src/i18n.rs` | Language of the Rust side |
| `src-tauri/src/lib.rs` | Tauri commands, menus, tray, updater, window behaviour |

## Notes

- The app changes nothing on the router. "Open router portal" points to the .1 of the connected network.
- The request bodies of the YXC calls for Link, `setWiredLan` and the location commands are not verified against the specification. The console shows the `response_code` of every step.
- While monitoring runs, the window's close button does not quit the app; it stays in the tray. Quit through the tray menu.
- The CSV log is written to the Desktop by default; the path can be changed in Settings.
