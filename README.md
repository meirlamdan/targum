# Targum — Desktop Translation App

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Platform: Windows & macOS](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-lightgrey.svg)

Targum is a lightweight desktop app for instant text translation. Select any text anywhere on your screen, press a global hotkey, and get the translation in a floating window — without switching apps.

## Features

- **Global hotkey** — Select text in any app, press `Ctrl+Shift+T` (Windows) or `Cmd+Shift+T` (macOS) to translate instantly (configurable)
- **Two translation engines** — Google Translate and Bing Translator, toggle per-session
- **Text-to-speech** — Listen to the translation with word-by-word highlighting; US/British English accent toggle
- **20 languages** — See full list below
- **RTL support** — Full right-to-left rendering for Hebrew, Arabic, and Persian
- **System tray** — Lives in the tray, press the hotkey or click the tray icon to open
- **UI localization** — Interface available in English and Hebrew

## Screenshot

<!-- Add screenshot here -->

## Download & Install

Go to the [Releases](https://github.com/meirlamdan/targum/releases) page and download the latest version for your platform:

| Platform | File |
|----------|------|
| Windows 10/11 | `Targum_x.x.x_x64-setup.exe` |
| macOS (Apple Silicon) | `Targum_x.x.x_aarch64.dmg` |
| macOS (Intel) | `Targum_x.x.x_x64.dmg` |

No additional dependencies required.

## Development

**Requirements:** [Node.js](https://nodejs.org/) v18+, [Rust](https://rustup.rs/) stable

```bash
# Install dependencies
npm install

# Run in development mode (hot-reload)
npm run tauri dev

# Build production installer
npm run tauri build
```

The installer will be output to `src-tauri/target/release/bundle/`.

## Supported Languages

| Language | Code | | Language | Code |
|----------|------|-|----------|------|
| Hebrew | he | | Portuguese | pt |
| English | en | | Italian | it |
| French | fr | | Japanese | ja |
| Arabic | ar | | Korean | ko |
| Spanish | es | | Dutch | nl |
| Russian | ru | | Polish | pl |
| German | de | | Turkish | tr |
| Chinese | zh | | Ukrainian | uk |
| Persian | fa | | Hindi | hi |
| Swedish | sv | | Romanian | ro |

## Hotkey Configuration

The default hotkey is `Ctrl+Shift+T` on Windows and `Cmd+Shift+T` on macOS. You can change it in the settings panel inside the app. The new hotkey is saved automatically and persists across restarts.

## License

[MIT](LICENSE)
