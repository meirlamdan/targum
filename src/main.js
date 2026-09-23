// Targum backend — runs on txiki.js. Replaces the Tauri/Rust side:
// translation engines (Google / Bing / MyMemory), the global hotkey that
// copies the current selection, the tray icon, and hotkey persistence.

const DEFAULT_HOTKEY = 'cmd+shift+t'; // cmd = Ctrl on Windows/Linux
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

let currentHotkey = DEFAULT_HOTKEY;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function qs(params) {
  return Object.entries(params)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');
}

function snippet(body) {
  return body.slice(0, 300);
}

function extractBetween(s, prefix, end) {
  const i = s.indexOf(prefix);
  if (i === -1) return null;
  const start = i + prefix.length;
  const j = s.indexOf(end, start);
  return j === -1 ? null : s.slice(start, j);
}

// --- engines ----------------------------------------------------------------

async function translateGoogle(text, targetLang, sourceLang) {
  const url = 'https://translate.googleapis.com/translate_a/single?' +
    qs({ client: 'gtx', sl: sourceLang, tl: targetLang, dt: 't', q: text });
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`Google HTTP ${r.status}`);
  const raw = await r.json();
  // [[["translated", "original", ...], ...], null, "detected_lang", ...]
  if (!Array.isArray(raw?.[0])) throw new Error('Unexpected response format');
  return {
    translated: raw[0].map((chunk) => chunk?.[0] ?? '').join(''),
    detected_lang: typeof raw[2] === 'string' ? raw[2] : 'auto',
  };
}

const toBingLang = (l) => (l === 'auto' ? 'auto-detect' : l === 'zh' ? 'zh-Hans' : l);
const fromBingLang = (l) => (l === 'zh-Hans' || l === 'zh-Hant' ? 'zh' : l);

// Bing keeps anti-abuse tokens (IG / key / token) in the translator page and
// ties them to the session cookies, so scrape the page first and replay its
// cookies on the translate call.
function cookiesFrom(headers) {
  const raw = headers.get('set-cookie');
  if (!raw) return '';
  return raw
    .split(/,(?=\s*[^;,=\s]+=)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

async function translateBing(text, targetLang, sourceLang) {
  const pageRes = await fetch('https://www.bing.com/translator', {
    headers: {
      'User-Agent': BROWSER_UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  const page = await pageRes.text();
  const cookie = cookiesFrom(pageRes.headers);

  const ig = extractBetween(page, 'IG:"', '"') ?? extractBetween(page, '"IG":"', '"') ?? '';
  const iid = extractBetween(page, 'data-iid="', '"') ?? 'translator.5028.6';
  const key = (extractBetween(page, 'params_AbusePreventionHelper=[', ',') ??
               extractBetween(page, 'params_AbusePreventionHelper = [', ',') ?? '').trim();
  const token = key
    ? (extractBetween(page, `params_AbusePreventionHelper=[${key},"`, '"') ??
       extractBetween(page, `params_AbusePreventionHelper = [${key},"`, '"') ?? '')
    : '';

  const url = 'https://www.bing.com/ttranslatev3?isVertical=1' +
    (ig ? '&' + qs({ IG: ig, IID: iid }) : '');
  const form = { fromLang: toBingLang(sourceLang), text, to: toBingLang(targetLang) };
  if (key && token) Object.assign(form, { token, key });

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': BROWSER_UA,
      Referer: 'https://www.bing.com/translator',
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: qs(form),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`Bing HTTP ${r.status}: ${snippet(body)}`);
  let raw;
  try { raw = JSON.parse(body); } catch (e) { throw new Error(`Bing parse error — body: ${snippet(body)}`); }
  const translated = raw?.[0]?.translations?.[0]?.text;
  if (typeof translated !== 'string') throw new Error(`Bing: unexpected response — body: ${snippet(body)}`);
  const detected = raw[0]?.detectedLanguage?.language;
  return { translated, detected_lang: detected ? fromBingLang(detected) : 'auto' };
}

async function translateMyMemory(text, targetLang, sourceLang) {
  const langpair = `${sourceLang === 'auto' ? 'autodetect' : sourceLang}|${targetLang}`;
  const r = await fetch('https://api.mymemory.translated.net/get?' + qs({ q: text, langpair }), {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`MyMemory HTTP ${r.status}: ${snippet(body)}`);
  let raw;
  try { raw = JSON.parse(body); } catch (e) { throw new Error(`MyMemory parse error — body: ${snippet(body)}`); }
  if (raw.responseStatus === 429) throw new Error('MyMemory: daily quota exceeded (50 000 chars/day)');
  const translated = raw?.responseData?.translatedText;
  if (typeof translated !== 'string') throw new Error(`MyMemory: unexpected response — body: ${snippet(body)}`);
  const detected = raw.matches?.[0]?.['source-lang'];
  return { translated, detected_lang: detected ? detected.toLowerCase() : 'auto' };
}

const ENGINES = { google: translateGoogle, bing: translateBing, mymemory: translateMyMemory };

// --- selection capture ------------------------------------------------------

const IS_WIN = tjs.env.OS === 'Windows_NT';

// Windows: talk to user32 directly (as Targum's selection.rs did). The user
// is still holding the hotkey's modifiers when we fire, and app.keystroke
// only adds Ctrl — so Word etc. would see Ctrl+Shift+C (copy formatting)
// and the clipboard never changes. Release the held modifiers first.
let win32 = null;
async function getWin32() {
  if (win32) return win32;
  const ffi = await import('tjs:ffi');
  const user32 = new ffi.Lib('user32.dll');
  const { sint16, sint32, uint8, uint32, size, void: vd } = ffi.types;
  const keyState = new ffi.CFunction(user32.symbol('GetAsyncKeyState'), sint16, [sint32]);
  const kbd = new ffi.CFunction(user32.symbol('keybd_event'), vd, [uint8, uint8, uint32, size]);
  const clipSeq = new ffi.CFunction(user32.symbol('GetClipboardSequenceNumber'), uint32, []);
  win32 = {
    isDown: (vk) => (keyState.call(vk) & 0x8000) !== 0,
    key: (vk, up) => kbd.call(vk, 0, up ? 2 /* KEYEVENTF_KEYUP */ : 0, 0),
    clipSeq: () => clipSeq.call(),
  };
  return win32;
}

const VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12, VK_LWIN = 0x5b, VK_RWIN = 0x5c, VK_C = 0x43;

async function sendCopyWin() {
  const w = await getWin32();
  for (const vk of [VK_SHIFT, VK_MENU, VK_LWIN, VK_RWIN, VK_CONTROL]) {
    if (w.isDown(vk)) w.key(vk, true);
  }
  await sleep(30);
  w.key(VK_CONTROL, false);
  w.key(VK_C, false);
  w.key(VK_C, true);
  w.key(VK_CONTROL, true);
}

// Simulate Copy in the foreground app and wait (up to 600ms) for the
// clipboard to change. Returns '' when nothing new was copied.
async function captureSelection(app) {
  const changeCount = IS_WIN
    ? async () => (await getWin32()).clipSeq()
    : () => app.clipboard.changeCount();
  const before = await changeCount();
  if (IS_WIN) {
    await sendCopyWin();
  } else {
    // give the user a moment to let go of the hotkey's modifiers
    await sleep(150);
    await app.keystroke('cmd+c');
  }
  for (let i = 0; i < 6; i++) {
    await sleep(100);
    if ((await changeCount()) !== before) {
      const clip = await app.clipboard.read();
      if (clip.kind === 'text' && !clip.concealed) return (clip.text ?? '').trim();
      return '';
    }
  }
  return '';
}

// Targum's own tray icon (src-tauri/icons/64x64.png). Embedded so it works in
// a built app too, where there's no project dir to read it from; written to
// the data dir at startup because the tray wants a file path.
const TRAY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAACnUlEQVR42u2bsW/TQBTG371kAFEBZSFqpdYSRSAkp9cBRigTI+5iIhbKCkKt2JjIX4BggDVlQW0WysiExMpyNIgNyRlaCkMbBBILuuOdi0siFFMSC8W+9yRHjnKx9f383t2TfF8Z/hKef+2qBggEnYIw0hg4DiMcQkAHjFAGIEKA9ai19iJ1fF/h1fAGXaROgj3IcVggJHI52mg+PRAAT9Y8o/VzEi6hQEEglEBciNRq1BeAJ69Lo3+8GvU0HyobsHw5Us/UHwCKLr4XAs4lmYDJDyS+UXTxsU7SaEs8+V6yH1PVsA4GauBOVMZP+u3O53cKf9XBEjgWRuj7sXbPry1q0A1wMLAEC6iFngdHQ2sIkNL/kqsABDV55bx3esMRgNkyOBx2SXQagI0DA7h3J4AzMxO5Eba49CRbAGdPT8J5ecrdDHC+BJwEcHTs8H7djx05lCthSblufdqFzY87/VfCKT80/X68MDcDK49u5foJP268jA8ugUEAfP32Hd6oD5ndbLIyDhOVE6ljtrZ3YHN7N7N72uulNoNpJZB13L55JT6GSVleBRgAA2AADIABMAAGwAAYAANgAAyAATAABsAAGAADYAAMgAEwAAbAAAaM//Jm6P3rBwP979zFu8XIgCzfL+YyA3gOGOFA2j//xdkJkLQjbZNXzj5+0o5GQOSsftKOiLDubP2T9tgzNF0NO7Rv9phb9S/a7Y01b88xYnDZva3yot7jGpv2Q+u2nHVjlzy8bbeassc1JkoYuLAkWo1W6/48kJxYHx2ZCueLDCEWTxq73aPYPcA6KslUKG2KFDHtrbZu12i6eZrcZGQte5j31cHO9nbCi1qrK//kHv9tqQ0D666yBiMaLUcdSFzC1OHtNTlkn1fN1D7nJ5gb1ZyvaMCKAAAAAElFTkSuQmCC';

async function trayIconPath(app) {
  const dir = app.paths.data;
  const path = dir + '/tray.png';
  await tjs.makeDir(dir, { recursive: true });
  await tjs.writeFile(path, Uint8Array.from(atob(TRAY_PNG), (c) => c.charCodeAt(0)));
  return path;
}

function showWindow(app) {
  app.show();
  app.restore();
}

// --- OCR (Windows) ------------------------------------------------------------
// tinyjs's own OCR (tiny.macos.ocr) is macOS-only — the page uses it there.
// On Windows, call the built-in WinRT engine (Windows.Media.Ocr) through
// PowerShell. It reads the languages whose OCR pack is installed (English
// ships with Windows; there is no Hebrew pack). A missing pack for the chosen
// source language can be installed from the app (installOcrPack).

const OCR_PS1 = String.raw`
param([string]$Path, [string]$Crop, [string]$Lang)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1' })[0]
function Await($op, [Type]$t) {
  $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait() | Out-Null; $task.Result
}
[void][Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
[void][Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics, ContentType = WindowsRuntime]
[void][Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
try {
  # -Lang "ru": the source language the user picked. Its pack may be missing
  # (the page then offers to install it).
  if ($Lang) {
    $l = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages |
      Where-Object { $_.LanguageTag -like "$Lang*" } | Select-Object -First 1
    if (-not $l) { @{ ok = $false; missing = $Lang } | ConvertTo-Json -Compress; exit }
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($l)
  } else {
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  }
  if (-not $engine) {
    $lang = [Windows.Media.Ocr.OcrEngine]::AvailableRecognizerLanguages | Select-Object -First 1
    if ($lang) { $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang) }
  }
  if (-not $engine) { throw 'No OCR language is installed in Windows' }
  # Crop (-Crop "x,y,w,h", pixels) and upscale with System.Drawing into a
  # temp png first: Windows OCR misses small text (one line of UI text comes
  # back empty), and 2-3x makes it read cleanly.
  Add-Type -AssemblyName System.Drawing
  $src = [System.Drawing.Bitmap]::FromFile($Path)
  $cx = 0; $cy = 0; $w = $src.Width; $h = $src.Height
  if ($Crop) {
    $c = $Crop.Split(',') | ForEach-Object { [int]$_ }
    $cx = [Math]::Max(0, $c[0]); $cy = [Math]::Max(0, $c[1])
    $w = [Math]::Min($c[2], $src.Width - $cx); $h = [Math]::Min($c[3], $src.Height - $cy)
  }
  $scale = if ($h -lt 300) { 3 } elseif ([Math]::Max($w, $h) -lt 2000) { 2 } else { 1 }
  $max = [Windows.Media.Ocr.OcrEngine]::MaxImageDimension
  while ($scale -gt 1 -and [Math]::Max($w, $h) * $scale -gt $max) { $scale-- }
  $dst = New-Object System.Drawing.Bitmap ([int]($w * $scale)), ([int]($h * $scale))
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($src, (New-Object System.Drawing.Rectangle 0, 0, $dst.Width, $dst.Height), $cx, $cy, $w, $h, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose(); $src.Dispose()
  $tmp = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'targum-ocr-' + [guid]::NewGuid().ToString('N') + '.png')
  $dst.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png); $dst.Dispose()

  $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($tmp)) ([Windows.Storage.StorageFile])
  $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $stream.Dispose(); Remove-Item $tmp -ErrorAction SilentlyContinue
  $lines = @($result.Lines | ForEach-Object { $_.Text })
  @{ ok = $true; text = ($lines -join "${'`'}n"); lang = $engine.RecognizerLanguage.LanguageTag } | ConvertTo-Json -Compress
} catch {
  @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress
}
`;

async function readAll(stream) {
  const reader = stream.getReader();
  const chunks = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return new TextDecoder().decode(out);
}

// Runs a PowerShell script (kept in the data dir) with no console window and
// returns the last line it printed.
async function runPowerShell(app, name, source, args) {
  const script = app.paths.data + '/' + name;
  await tjs.makeDir(app.paths.data, { recursive: true });
  // BOM so Windows PowerShell 5.1 reads the script as UTF-8
  await tjs.writeFile(script, new TextEncoder().encode('﻿' + source));
  const p = app.spawnHidden(
    ['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...args],
    { stdin: 'ignore', stdout: 'pipe', stderr: 'ignore' },
  );
  const [out] = await Promise.all([readAll(p.stdout), p.wait()]);
  return out.trim().split(/\r?\n/).pop();
}

// Windows OCR packs (Language.OCR~~~<tag>) for Targum's source languages.
// Hebrew, Ukrainian, Persian and Hindi have none.
const OCR_PACKS = {
  en: 'en-US', fr: 'fr-FR', ar: 'ar-SA', es: 'es-ES', ru: 'ru-RU', de: 'de-DE',
  zh: 'zh-CN', pt: 'pt-BR', it: 'it-IT', ja: 'ja-JP', ko: 'ko-KR', nl: 'nl-NL',
  pl: 'pl-PL', tr: 'tr-TR', sv: 'sv-SE', ro: 'ro-RO',
};

// lang: the source language, or null (auto) for the user's Windows languages.
// A language without an installed pack comes back as { missing, installable }.
async function ocrWindows(path, app, rect, lang) {
  // StorageFile.GetFileFromPathAsync rejects forward slashes
  const winPath = path.replace(/\//g, '\\');
  const out = await runPowerShell(app, 'ocr.ps1', OCR_PS1, [
    '-Path', winPath,
    ...(rect ? ['-Crop', [rect.x, rect.y, rect.width, rect.height].map((n) => Math.round(n)).join(',')] : []),
    ...(lang ? ['-Lang', lang] : []),
  ]);
  let r;
  try { r = JSON.parse(out); } catch { throw new Error('OCR failed'); }
  if (r.missing) return { text: '', missing: r.missing, installable: !!OCR_PACKS[r.missing] };
  if (!r.ok) throw new Error(r.error || 'OCR failed');
  return { text: r.text ?? '', lang: r.lang ?? '' };
}

// Installs a Windows OCR pack (a small download from Windows Update). Needs
// admin rights, so it runs elevated: the user gets the UAC prompt.
// Prints ok | cancelled (UAC declined) | failed.
const INSTALL_OCR_PS1 = String.raw`
param([string]$Name)
$cmd = "try { Add-WindowsCapability -Online -Name '$Name' -ErrorAction Stop | Out-Null; exit 0 } catch { exit 1 }"
$enc = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cmd))
$argv = "-NoProfile -NonInteractive -EncodedCommand $enc"
try {
  $p = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList $argv -ErrorAction Stop
} catch { 'cancelled'; exit }
if ($p.ExitCode -eq 0) { 'ok' } else { 'failed' }
`;

async function installOcrPack(app, lang) {
  const tag = OCR_PACKS[lang];
  if (!tag) return 'failed';
  const out = await runPowerShell(app, 'install-ocr.ps1', INSTALL_OCR_PS1, ['-Name', `Language.OCR~~~${tag}~0.0.1.0`]);
  return ['ok', 'cancelled'].includes(out) ? out : 'failed';
}

// --- screen region → OCR -------------------------------------------------------
// The user drags a rectangle with the mouse and Targum opens with the text.
// Windows: our own overlay — capture the screen under the mouse, show it
// frozen in a frameless full-screen window (snip.html), and OCR the dragged
// rectangle (cropped in the OCR script). macOS: `screencapture -i`, which
// saves the selection straight to a file with no editor window.

const DEFAULT_OCR_HOTKEY = 'cmd+shift+o';
let currentOcrHotkey = DEFAULT_OCR_HOTKEY;
let capturing = false;
let snip = null; // { path, width, height, done(rect | null) } while the overlay is up
let lastCapture = null;

async function captureRegion(app) {
  if (capturing) return;
  capturing = true;
  try {
    const state = await app.getWinState();
    if (state?.visible) {
      app.hide(); // don't cover what the user wants to select
      await sleep(250);
    }
    const shot = IS_WIN ? await snipWindows(app) : await snipMac(app);
    if (!shot) return; // cancelled
    showWindow(app);
    app.push('translate-image', shot);
  } finally {
    capturing = false;
  }
}

async function snipWindows(app) {
  if (lastCapture) tjs.remove(lastCapture).catch(() => {});
  const [mouse, screens] = await Promise.all([app.mousePosition(), app.screens()]);
  const scr = screens.find((s) => s.x === mouse?.screen?.x && s.y === mouse?.screen?.y)
    ?? screens.find((s) => s.primary) ?? screens[0];
  const cap = await app.captureScreen(scr.id);
  lastCapture = cap.path;

  const rect = await new Promise((resolve) => {
    snip = { ...cap, done: resolve };
    app.openWindow('snip', {
      page: 'snip.html',
      title: 'Targum',
      size: `${scr.width}x${scr.height}`,
      x: scr.x,
      y: scr.y,
      chrome: { frame: false },
    });
    const w = app.window('snip');
    w.setAlwaysOnTop(true);
    w.setFullscreen(true);
    w.show();
  });
  snip = null;
  app.window('snip').close();
  if (!rect) return null;
  // normalized 0..1 → pixels of the captured image
  const px = {
    x: Math.round(rect.x * cap.width),
    y: Math.round(rect.y * cap.height),
    width: Math.max(1, Math.round(rect.width * cap.width)),
    height: Math.max(1, Math.round(rect.height * cap.height)),
  };
  return { path: cap.path, rect: px };
}

async function snipMac(app) {
  const path = app.paths.temp + '/targum-region-' + Date.now() + '.png';
  const p = tjs.spawn(['screencapture', '-i', '-x', path], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
  await p.wait();
  try { await tjs.stat(path); return { path }; } catch { return null; } // Esc = no file
}

// --- api --------------------------------------------------------------------

export const api = {
  async translate({ text, targetLang, sourceLang = 'auto', engine = 'google' }) {
    if (!text?.trim()) return { translated: '', detected_lang: '' };
    const fn = ENGINES[engine] ?? translateGoogle;
    return fn(text, targetLang, sourceLang);
  },

  async getHotkeys() {
    return { translate: currentHotkey, ocr: currentOcrHotkey };
  },

  // id: 'translate' (copy selection) | 'ocr' (screen region)
  async setHotkey({ id = 'translate', combo }, app) {
    app.hotkey.unregister(id);
    app.hotkey.register(id, combo);
    if (id === 'ocr') currentOcrHotkey = combo;
    else currentHotkey = combo;
    await app.store.set(id === 'ocr' ? 'ocrHotkey' : 'hotkey', combo);
    return combo;
  },

  // The in-window button; runs detached so the page call returns at once.
  async captureRegion(_p, app) {
    captureRegion(app);
    return true;
  },

  // snip.html: which screenshot to show, then the dragged rectangle
  // (normalized 0..1) or null for Esc.
  async snipInfo() {
    return snip ? { path: snip.path } : null;
  },
  async snipDone({ rect }) {
    snip?.done(rect ?? null);
    return true;
  },

  // Text from an image file (Windows), optionally only from rect (pixels).
  // The page handles macOS itself.
  async ocr({ path, rect, lang }, app) {
    if (!IS_WIN) throw new Error('unsupported');
    return ocrWindows(path, app, rect, lang);
  },

  // → 'ok' | 'cancelled' | 'failed'
  async installOcrLanguage({ lang }, app) {
    if (!IS_WIN) return 'failed';
    return installOcrPack(app, lang);
  },

  async appInfo(_p, app) {
    return { version: app.info.version };
  },
};

export async function init(app) {
  currentHotkey = (await app.store.get('hotkey')) ?? DEFAULT_HOTKEY;
  app.hotkey.register('translate', currentHotkey);
  currentOcrHotkey = (await app.store.get('ocrHotkey')) ?? DEFAULT_OCR_HOTKEY;
  app.hotkey.register('ocr', currentOcrHotkey);

  // same tray as Targum's tray.rs: the app icon in colour, left-click
  // toggles the window, menu = Open Translator / Quit (+ screen region)
  app.tray.set({
    icon: await trayIconPath(app),
    template: false,
    tooltip: 'Targum',
    primaryAction: true,
    menu: [
      { id: 'open', label: 'Open Translator' },
      { id: 'region', label: 'Translate Screen Region' },
      { id: 'quit', label: 'Quit' },
    ],
  });
  app.setHideOnClose(true);
  // "activation": "accessory" gives the hidden start Targum had, but on
  // Windows it also makes a tool window (small ✕ only, no taskbar button).
  // Targum's window was a normal one — minimize / maximize / close.
  if (IS_WIN) app.presence('normal');
}

export async function onHotkey(id, app) {
  if (id === 'ocr') return captureRegion(app);
  if (id !== 'translate') return;
  const text = await captureSelection(app);
  showWindow(app);
  app.push('translate-selection', { text });
}

// The close button hides the window (setHideOnClose) without an event of its
// own, only a focus loss — so check visibility then, and clear the source
// text like Targum did on CloseRequested.
export async function onWindowState(info, app) {
  if (info.win !== 'main' || info.focused) return;
  await sleep(50);
  const state = await app.getWinState();
  if (state && !state.visible) app.push('window-hidden', {});
}

// Overlay closed some other way (Alt+F4) — treat it as cancel.
export function onWindowClosed(id) {
  if (id === 'snip') snip?.done(null);
}

export async function onTray(id, app) {
  if (id === 'quit') return app.quit();
  if (id === 'open') return showWindow(app);
  if (id === 'region') return captureRegion(app);
  // id === null: left-click on the icon toggles the window; hiding clears
  // the source text, as in Targum
  const state = await app.getWinState();
  if (state?.visible) {
    app.hide();
    // the tray click already took focus, so no focus event follows the hide
    app.push('window-hidden', {});
  } else {
    showWindow(app);
  }
}
