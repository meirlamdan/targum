# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
tinyjs dev       # run with hot reload (frontend edits swap in place; backend edits restart)
tinyjs build     # dist/targum(.exe) (+ Targum.app on macOS)
tinyjs publish   # build + dist/publish/<zip> + manifest.json
TINYJS_DEBUG=1 tinyjs dev   # trace every bridge message
```

No test, lint, or npm scripts — there are no dependencies.

## Architecture

**Targum** — [tinyjs](https://tinyjs.app) desktop translation app: a txiki.js backend (`src/main.js`) + a plain HTML/CSS/JS page in the system webview (`src/frontend/`). They talk over `tiny.api.call(...)` / `app.push(...)`. The window starts hidden and lives in the system tray.

**Global hotkey flow (configurable, default Ctrl/Cmd+Shift+T):**
1. `onHotkey` in `src/main.js` — releases held modifiers and sends Ctrl+C (Windows: user32 via `tjs:ffi`; macOS/Linux: `app.keystroke('cmd+c')`), then polls the clipboard for up to 600ms
2. Backend shows the window and pushes a `translate-selection` event with the text
3. `app.js` sets the source text and translates immediately
4. `translate` api method in `src/main.js` calls Google, Bing or MyMemory with `fetch`
5. TTS runs in the page: Web Speech API, or Google TTS through `tiny.fetch` when no system voice exists

## Key Files

| File | Role |
|------|------|
| `src/main.js` | Backend: translation engines, hotkey + selection capture, tray, hide-on-close, hotkey persistence |
| `src/frontend/app.js` | Whole UI: panels, language dropdowns, history, settings, TTS, updater |
| `src/frontend/i18n.js` | UI strings (en, he, ru, fr) |
| `src/frontend/style.css` | Styles |
| `tinyjs.json` | App config: name, id, size, version, icon, update URL |
| `.github/workflows/release.yml` | On `v*` tag: `tinyjs publish` on Windows + macOS, merge manifests, create the GitHub release, bump the version on the gh-pages landing page |

## Key Details

- **App id:** `com.meir.targum`. Bump `version` in `tinyjs.json` before tagging a release.
- **Languages:** 20 languages hardcoded in `app.js`. RTL is applied for Hebrew, Arabic, and Persian.
- **Translation engines:** Google (`translate.googleapis.com/translate_a/single`), Bing (scrapes the translator page for IG/key/token and replays its cookies), MyMemory (`api.mymemory.translated.net/get`, 50 000 chars/day).
- **Persistence:** everything goes through `tiny.store` (JSON in the app data dir): `targetLang`, `translationEngine`, `appLocale`, `englishAccent`, `translationHistory` from the page; `hotkey` from the backend. Not localStorage — the page is file:// and it isn't reliable there.
- **Window:** 680×420 (min 400×240). `"activation": "accessory"` starts it hidden; on Windows that also makes a tool window, so `init` calls `app.presence('normal')` to get normal min/max/close buttons back. Close hides (`setHideOnClose`); `onWindowState` detects the hide and pushes `window-hidden`, which clears the text.
- **Tray:** icon is embedded as base64 in `main.js` and written to the data dir (the tray needs a file path, and a built app has no project dir). Left-click toggles the window; menu has "Open Translator" and "Quit".
- **Updates:** `update.check` / `update.install` against `https://github.com/meirlamdan/targum/releases/latest/download/manifest.json`. No download progress is reported, so the bar is indeterminate.
- **Hotkey registration** is fire-and-forget in tinyjs — a combo held by another app fails silently.
- **Escape anything put into `innerHTML`** (`escapeHtml` in `app.js`) — the page holds an RPC channel to the backend.

## Commit Messages

- Keep commit messages concise and direct - no verbose multi-paragraph descriptions
- Do NOT include 'Generated with Claude Code' or co-author trailers unless explicitly requested
