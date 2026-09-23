# Targum — Desktop Translation App

![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)
![Platform: Windows & macOS](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-lightgrey.svg)

Targum is a lightweight desktop app for instant text translation. Select any text anywhere on your screen, press a global hotkey, and get the translation in a floating window — without switching apps.

Built with [tinyjs](https://tinyjs.app): a small JavaScript backend (txiki.js) and the system webview, with no framework and no npm dependencies. The app is about 6 MB.

## Features

- **Global hotkey** — Select text in any app, press `Ctrl+Shift+T` (Windows) or `Cmd+Shift+T` (macOS) to translate instantly (configurable)
- **Three translation engines** — Google Translate, Bing Translator, and MyMemory, selectable per-session
- **Text-to-speech** — Listen to the translation with word-by-word highlighting; falls back to Google TTS when there's no system voice for the language; US/British English accent toggle in settings
- **20 languages** — See full list below
- **RTL support** — Full right-to-left rendering for Hebrew, Arabic, and Persian
- **Translate a screen region** — Press `Ctrl+Shift+O` (`Cmd+Shift+O` on macOS, configurable), click the region button, or pick "Translate Screen Region" in the tray, then drag a rectangle with the mouse; the text in it is read and translated
- **Translate screenshots** — Paste a screenshot (`Win+Shift+S` / `Cmd+Ctrl+Shift+4`, then `Ctrl/Cmd+V`) or drop an image on the window; the text is read and translated by the system's own OCR. See [Reading Text From Images](#reading-text-from-images-ocr) for the languages
- **History** — The last 100 translations, click one to restore it
- **System tray** — Lives in the tray, press the hotkey or click the tray icon to open
- **UI localization** — Interface available in English, Hebrew, Russian, and French

## Screenshot
<img width="784" height="374" alt="image" src="https://github.com/user-attachments/assets/57afaccc-1d90-4712-a315-5b5912ad451d" />


## Download & Install

Go to the [Releases](https://github.com/meirlamdan/targum/releases) page and download the latest version for your platform:

| Platform | File |
|----------|------|
| Windows 10/11 | `targum-x.x.x-win.zip` — unzip and run `targum.exe` |
| macOS 14+ | `targum-x.x.x.zip` — unzip and move `Targum.app` to Applications |

No additional dependencies required. On macOS, copying the selected text needs Accessibility permission.

## Development

**Requirements:** [tinyjs](https://tinyjs.app)

```bash
# Install tinyjs (once)
irm https://tinyjs.app/install.ps1 | iex      # Windows (PowerShell)
curl -fsSL https://tinyjs.app/install | sh    # macOS / Linux

# Run in development mode (hot-reload)
tinyjs dev

# Build the app (dist/)
tinyjs build

# Build + zip + update manifest (dist/publish/)
tinyjs publish
```

Releases are built by GitHub Actions when a `v*` tag is pushed.

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

## Reading Text From Images (OCR)

Screenshots and screen regions are read by the operating system's own text recognition. Nothing is sent online until the text is translated.

**Windows** uses the built-in Windows OCR. It reads a language only when that language's Windows OCR pack is installed.

| Languages | Status |
|-----------|--------|
| English | Installed with Windows |
| French, Arabic, Spanish, Russian, German, Chinese, Portuguese, Italian, Japanese, Korean, Dutch, Polish, Turkish, Swedish, Romanian | A free Windows pack, which Targum can install for you |
| Hebrew, Ukrainian, Persian, Hindi | Not supported: Windows has no OCR pack for them |

- With the source language on **Auto-detect**, Windows reads the image with the OCR languages of your Windows language list, or English. Targum doesn't offer an install in this mode.
- If you choose a source language whose pack isn't installed, Targum asks whether to install it. Installing needs administrator approval (the Windows UAC prompt) and a small download from Microsoft. The image is then read again automatically.
- If you cancel, Targum tells you that the pack isn't installed. If the install fails (for example, with no internet connection or when updates are blocked by an organization), Targum offers to open Windows language settings. There, add the language and install **Optical character recognition** in its options.
- If you choose Hebrew, Ukrainian, Persian or Hindi, Targum explains that Windows can't read that language and suggests Auto-detect for English.

**macOS** uses Apple's built-in text recognition (Vision). There are no packs to install, and the source-language choice doesn't change how the image is read. English works. The other languages depend on macOS, and Hebrew isn't guaranteed.

**Linux:** not supported.

## Hotkey Configuration

The default hotkey is `Ctrl+Shift+T` on Windows and `Cmd+Shift+T` on macOS. You can change it in the settings panel inside the app. The new hotkey is saved automatically and persists across restarts.

## License

[MIT](LICENSE)
