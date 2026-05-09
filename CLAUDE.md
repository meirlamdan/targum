# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Full desktop app (Rust + Vue hot-reload)
npm run tauri dev

# Frontend only (no Tauri APIs, runs at localhost:1420)
npm run dev

# Build frontend only (type-check + Vite)
npm run build

# Build web-mode bundle (strips all Tauri imports)
npm run build:web

# Production desktop build (installers in src-tauri/target/release/bundle)
npm run tauri build
```

No test or lint scripts are configured yet.

## Architecture

**Targum** — Tauri 2 desktop translation app: Vue 3 SPA frontend + Rust backend. The window starts hidden and lives in the system tray.

**Global hotkey flow (configurable, default Ctrl+Shift+T):**
1. `selection.rs` — focuses foreground window, simulates Ctrl+C, reads clipboard (polls 600ms)
2. Rust emits `translate-selection` Tauri event with captured text
3. `useHotkeyText.ts` listens for the event, sets `sourceText` in `App.vue`
4. `useTranslation.ts` calls the API layer (500ms debounce for typed input, immediate for hotkey)
5. `translate.ts` invokes `translate_text` (Google) or `translate_bing_text` (Bing) Tauri command
6. `translate.rs` — Rust command makes HTTP request to Google or Bing API
7. Result rendered in `App.vue`; TTS handled by `useSpeech.ts` via Web Speech API


## Key Files

| File | Role |
|------|------|
| `src-tauri/src/lib.rs` | App entry: registers IPC commands, tray, global shortcut, hotkey state |
| `src-tauri/src/selection.rs` | Hotkey handler — clipboard capture via `arboard` + Win32 `SendInput` |
| `src-tauri/src/translate.rs` | `translate_text` (Google) + `translate_bing_text` (Bing) Tauri commands |
| `src-tauri/src/config.rs` | Hotkey persistence — saves/loads `config.json` in app config dir |
| `src-tauri/src/tray.rs` | Tray menu (Open / Quit); left-click toggles window visibility |
| `src/App.vue` | Main UI: dual-panel, language picker, engine toggle, settings panel, TTS |
| `src/composables/useTranslation.ts` | Translation state + 500ms debounce |
| `src/composables/useHotkeyText.ts` | Bridges `translate-selection` Tauri event to App.vue |
| `src/composables/useSpeech.ts` | Web Speech API wrapper with word-boundary highlighting |
| `src/composables/useUpdater.ts` | In-app update checker — wraps `check_for_update` / `install_update` Tauri commands, tracks download progress |
| `src/api/translate.ts` | API layer — routes to `invoke('translate_text'`, `translate_bing_text`, or `translate_mymemory_text`)` |
| `src/i18n/index.ts` | vue-i18n setup (en + he); locale persisted in localStorage |
| `src/i18n/en.ts` | English UI strings (31 keys) |
| `src/i18n/he.ts` | Hebrew UI strings (31 keys) |

## Key Details

- **App name:** Targum (`com.meir.targum`). Product name is "Targum" in `tauri.conf.json`.
- **Languages:** 20 languages hardcoded in `App.vue`: Hebrew, English, French, Arabic, Spanish, Russian, German, Chinese, Portuguese, Italian, Japanese, Korean, Dutch, Polish, Turkish, Ukrainian, Persian, Hindi, Swedish, Romanian. RTL is applied for Hebrew, Arabic, and Persian.
- **Translation engines:** Google (`translate.googleapis.com/translate_a/single`), Bing (scrapes page for anti-abuse tokens before each request), and MyMemory (`api.mymemory.translated.net/get`, free quota: 50 000 chars/day). Engine toggled per-session, persisted in localStorage.
- **Text-to-speech:** `useSpeech.ts` wraps `SpeechSynthesisUtterance`. Supports US/British English accent toggle. Tracks word boundaries via `onboundary` for live word highlighting.
- **In-app updates:** `useUpdater.ts` calls `check_for_update` / `install_update` Tauri commands (via `tauri-plugin-updater`). Update endpoint: `https://github.com/meirlamdan/targum/releases/latest/download/latest.json`. Emits `update-progress` event during download for progress tracking.
- **Hotkey configuration:** User can record a new hotkey in the settings panel. `set_hotkey` Tauri command re-registers the shortcut and saves it via `config.rs`. `get_hotkey` reads the current value. Default: `Ctrl+Shift+T`.
- **Window:** 680×420 (min 400×240), starts hidden (`visible: false`), centered. Close button hides the window instead of quitting.
- **Tray:** Left-click toggles visibility. Menu has "Open Translator" and "Quit".
- **UI locale:** English and Hebrew, toggled in settings, persisted in localStorage.
- **CSP:** `tauri.conf.json` allows `https://translate.googleapis.com`. Bing API calls go through Rust/reqwest (not subject to browser CSP). Any new external domains called from the frontend need to be added to CSP.
- **Platform support:** Windows and macOS. `selection.rs` uses `windows-sys` on Windows and `core-graphics` on macOS (both under `#[cfg(target_os)]`). Linux is not supported.
- **State persistence:** `targetLang`, `engine`, `appLocale`, `englishAccent` in localStorage; hotkey in Rust `config.json` via `app.path().app_config_dir()`.
