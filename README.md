# Targum — Desktop Translation App

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Platform: Windows](https://img.shields.io/badge/Platform-Windows-lightgrey.svg)

Targum is a lightweight Windows desktop app for instant text translation. Select any text anywhere on your screen, press a global hotkey, and get the translation in a floating window — without switching apps.

## Features

- **Global hotkey** — Select text in any app, press `Ctrl+Shift+T` to translate instantly (configurable)
- **Two translation engines** — Google Translate and Bing Translator, toggle per-session
- **Text-to-speech** — Listen to the translation with word-by-word highlighting; US/British English accent toggle
- **8 languages** — Hebrew, English, French, Arabic, Spanish, Russian, German, Chinese
- **RTL support** — Full right-to-left rendering for Hebrew and Arabic
- **System tray** — Lives in the tray, press the hotkey or click the tray icon to open
- **UI localization** — Interface available in English and Hebrew

## Screenshot

<!-- Add screenshot here -->

## Requirements

- Windows 10/11
- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://rustup.rs/) (stable)

## Getting Started

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

| Language | Code |
|----------|------|
| Hebrew | he |
| English | en |
| French | fr |
| Arabic | ar |
| Spanish | es |
| Russian | ru |
| German | de |
| Chinese | zh-CN |

## Hotkey Configuration

The default hotkey is `Ctrl+Shift+T`. You can change it in the settings panel inside the app. The new hotkey is saved automatically and persists across restarts.

## Notes

- **Windows only** — The clipboard capture mechanism uses Win32 APIs (`GetForegroundWindow`, `SendInput`). Other platforms are not supported without significant changes.
- No API keys required — uses public translation endpoints.

## License

[MIT](LICENSE)
