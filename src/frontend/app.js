// Targum frontend — plain JS port of App.vue, LangSelect.vue and the
// composables (useTranslation, useSpeech, useHotkeyText, useUpdater).
import { MESSAGES, APP_LANGUAGES } from './i18n.js';

const $ = (id) => document.getElementById(id);

// --- persistence (tiny.store, same keys Targum kept in localStorage) ---------
// The page is served from file://, where localStorage isn't guaranteed to
// survive restarts in every webview; tiny.store is a JSON file in the app's
// data dir. Loaded once up front, then written through.

const stored = (await tiny.store.all().catch(() => null)) ?? {};

function load(key, fallback) {
  return stored[key] ?? fallback;
}
function save(key, value) {
  if (value == null) { delete stored[key]; tiny.store.delete(key); }
  else { stored[key] = value; tiny.store.set(key, value); }
}

// --- i18n --------------------------------------------------------------------

const SUPPORTED_LOCALES = APP_LANGUAGES.map((l) => l.code);
function detectLocale() {
  const sys = navigator.language.split('-')[0];
  return SUPPORTED_LOCALES.includes(sys) ? sys : 'en';
}

let locale = load('appLocale', detectLocale());

function t(key, params) {
  const lookup = (msgs) => key.split('.').reduce((o, k) => o?.[k], msgs);
  let s = lookup(MESSAGES[locale]) ?? lookup(MESSAGES.en) ?? key;
  if (params) for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, v);
  return s;
}

// --- constants ---------------------------------------------------------------

const LANGUAGES = [
  { code: 'he', label: 'עברית' },
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
  { code: 'ar', label: 'العربية' },
  { code: 'es', label: 'Español' },
  { code: 'ru', label: 'Русский' },
  { code: 'de', label: 'Deutsch' },
  { code: 'zh', label: '中文' },
  { code: 'pt', label: 'Português' },
  { code: 'it', label: 'Italiano' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'pl', label: 'Polski' },
  { code: 'tr', label: 'Türkçe' },
  { code: 'uk', label: 'Українська' },
  { code: 'fa', label: 'فارسی' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'sv', label: 'Svenska' },
  { code: 'ro', label: 'Română' },
];
const RTL_LANGS = new Set(['he', 'ar', 'fa', 'ur']);
const ENGINE_OPTIONS = [
  { code: 'google', label: 'Google' },
  { code: 'bing', label: 'Bing' },
  { code: 'mymemory', label: 'MyMemory' },
];
const GOOGLE_CODE_MAP = { iw: 'he', jw: 'jv' };
const SUPPORTED_LANG_CODES = new Set(LANGUAGES.map((l) => l.code));

function systemDefaultLang() {
  const primary = navigator.language.split('-')[0].toLowerCase();
  return SUPPORTED_LANG_CODES.has(primary) ? primary : 'he';
}

function displayLanguages() {
  return LANGUAGES.map((lang) => {
    const uiName = t(`langNames.${lang.code}`);
    return { ...lang, label: lang.label === uiName ? lang.label : `${lang.label} (${uiName})` };
  });
}
function sourceLanguages() {
  return [{ code: 'auto', label: t('autoDetect') }, ...displayLanguages()];
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// --- state -------------------------------------------------------------------

const state = {
  sourceText: '',
  sourceLang: 'auto',
  targetLang: load('targetLang', systemDefaultLang()),
  engine: load('translationEngine', 'google'),
  englishAccent: load('englishAccent', 'en-US'),
  result: { translated: '', detected_lang: '' },
  loading: false,
  ocrBusy: false,
  error: null,
  copied: false,
  view: 'main', // 'main' | 'settings' | 'history'
  history: load('translationHistory', []),
  hotkey: 'cmd+shift+t',
  recordingHotkey: false,
  hotkeyError: '',
  version: '',
  update: { status: 'idle', latest: '', error: '' },
  speakingPanel: null, // 'source' | 'target' | null
  wordRange: null,
};

// --- LangSelect (custom dropdown) ------------------------------------------

function createLangSelect(host, { getOptions, get, set, small = false }) {
  host.className = 'ls-wrap' + (small ? ' small' : '');
  host.innerHTML = '<button class="ls-trigger" type="button"><span class="ls-label"></span><span class="ls-arrow">▾</span></button>';
  const trigger = host.querySelector('.ls-trigger');
  const label = host.querySelector('.ls-label');
  const arrow = host.querySelector('.ls-arrow');
  let list = null;

  function close() {
    list?.remove();
    list = null;
    arrow.classList.remove('open');
  }

  function open() {
    const rect = trigger.getBoundingClientRect();
    const available = window.innerHeight - rect.bottom - 8;
    list = document.createElement('ul');
    list.className = 'ls-list';
    list.style.maxHeight = Math.min(220, Math.max(100, available)) + 'px';
    list.style.overflowY = 'auto';
    list.style.overflowX = 'hidden';
    for (const opt of getOptions()) {
      const li = document.createElement('li');
      li.className = 'ls-item' + (opt.code === get() ? ' active' : '');
      li.textContent = opt.label;
      li.addEventListener('click', () => { close(); set(opt.code); });
      list.appendChild(li);
    }
    host.appendChild(list);
    arrow.classList.add('open');
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  trigger.addEventListener('click', () => (list ? close() : open()));
  document.addEventListener('mousedown', (e) => {
    if (list && !host.contains(e.target)) close();
  });

  return {
    refresh() {
      const code = get();
      label.textContent = getOptions().find((o) => o.code === code)?.label ?? code;
    },
    close,
  };
}

// --- translation (useTranslation) ------------------------------------------

let translateTimer = null;
let translateSeq = 0;

function translate(immediate = false) {
  clearTimeout(translateTimer);
  const text = state.sourceText;
  if (!text.trim()) {
    translateSeq++;
    state.result = { translated: '', detected_lang: '' };
    state.error = null;
    state.loading = false;
    render();
    return;
  }
  translateTimer = setTimeout(async () => {
    const seq = ++translateSeq;
    state.loading = true;
    state.error = null;
    render();
    try {
      const result = await tiny.api.call('translate', {
        text,
        targetLang: state.targetLang,
        sourceLang: state.sourceLang,
        engine: state.engine,
      });
      if (seq !== translateSeq) return;
      state.result = result;
      state.loading = false;
      recordHistory();
    } catch (e) {
      if (seq !== translateSeq) return;
      state.error = e?.message || (typeof e === 'string' ? e : t('translationFailed'));
      state.loading = false;
    }
    render();
  }, immediate ? 0 : 500);
}

// --- history -----------------------------------------------------------------

function saveHistory() {
  save('translationHistory', state.history.length ? state.history : null);
}

function recordHistory() {
  const { translated, detected_lang } = state.result;
  const src = state.sourceText;
  if (!translated || !src) return;
  const last = state.history[0];
  if (last?.sourceText === src && last.targetLang === state.targetLang && last.engine === state.engine) return;
  const isTypingSession = !!last &&
    last.targetLang === state.targetLang &&
    last.engine === state.engine &&
    (Date.now() - last.timestamp) < 5 * 60 * 1000 &&
    (src.startsWith(last.sourceText) || last.sourceText.startsWith(src));
  const entry = {
    id: isTypingSession ? last.id : Date.now(),
    sourceText: src,
    translated,
    sourceLang: state.sourceLang,
    detectedLang: detected_lang ?? '',
    targetLang: state.targetLang,
    engine: state.engine,
    timestamp: Date.now(),
  };
  state.history = [entry, ...(isTypingSession ? state.history.slice(1) : state.history)].slice(0, 100);
  saveHistory();
}

function relativeTime(ts) {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 3600) return rtf.format(-Math.floor(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.floor(diff / 3600), 'hour');
  return rtf.format(-Math.floor(diff / 86400), 'day');
}

function langLabel(code, detected) {
  if (code === 'auto') {
    if (!detected) return t('autoDetect');
    code = GOOGLE_CODE_MAP[detected] ?? detected;
  }
  return displayLanguages().find((l) => l.code === code)?.label ?? code;
}

// --- speech (useSpeech) ------------------------------------------------------

const hasSpeech = 'speechSynthesis' in window;
if (hasSpeech) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener?.('voiceschanged', () => speechSynthesis.getVoices());
}
const normalizeLang = (l) => GOOGLE_CODE_MAP[l] ?? l;

function voices() {
  return hasSpeech ? speechSynthesis.getVoices() : [];
}

function getBestVoice(lang, preferred) {
  const vs = voices();
  if (!vs.length) return null;
  const base = lang.split('-')[0];
  if (preferred && preferred.split('-')[0] === base) {
    const exact = vs.find((v) => v.lang === preferred) ?? vs.find((v) => v.lang.startsWith(preferred + '-'));
    if (exact) return exact;
  }
  return vs.find((v) => v.lang === lang) ??
    vs.find((v) => v.lang.startsWith(base + '-')) ??
    vs.find((v) => v.lang.split('-')[0] === base) ?? null;
}

let ttsAudio = null;
let utterance = null;
let ttsUrl = null;

function chunkText(text, max) {
  const chunks = [];
  let cur = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (cur && cur.length + 1 + word.length > max) { chunks.push(cur); cur = ''; }
    cur = cur ? cur + ' ' + word : word;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

// No system voice for the language → Google TTS through the backend-proxied
// tiny.fetch, played in a plain <audio> element (audio only, no highlight).
async function speakGoogle(text, lang) {
  const parts = [];
  for (const chunk of chunkText(text, 200)) {
    const url = 'https://translate.googleapis.com/translate_tts?' +
      new URLSearchParams({ ie: 'UTF-8', q: chunk, tl: lang, client: 'gtx', ttsspeed: '1' });
    const r = await tiny.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    parts.push(await r.arrayBuffer());
  }
  if (!state.speakingPanel) return;
  ttsUrl = URL.createObjectURL(new Blob(parts, { type: 'audio/mpeg' }));
  ttsAudio = new Audio(ttsUrl);
  ttsAudio.onended = ttsAudio.onerror = stopSpeaking;
  await ttsAudio.play();
}

function speak(panel, text, lang, preferred) {
  if (!text.trim() || !lang) return;
  stopSpeaking();
  state.speakingPanel = panel;
  const norm = normalizeLang(lang);
  const voice = getBestVoice(norm, preferred);

  if (!voice) {
    speakGoogle(text, normalizeLang(preferred ?? lang)).catch(stopSpeaking);
    render();
    return;
  }

  const u = utterance = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang.split('-')[0] === norm.split('-')[0] ? norm : voice.lang;
  u.onboundary = (e) => {
    if (u !== utterance || e.name !== 'word') return;
    const start = e.charIndex;
    const rest = text.slice(start);
    const spaceIdx = rest.search(/\s/);
    const len = e.charLength || (spaceIdx === -1 ? rest.length : spaceIdx);
    state.wordRange = { start, end: start + len };
    renderSpeech();
  };
  // cancel() fires the previous utterance's end/error late — ignore stale ones
  u.onend = u.onerror = () => { if (u === utterance) stopSpeaking(); };
  speechSynthesis.speak(u);
  render();
}

function stopSpeaking() {
  utterance = null;
  if (hasSpeech) speechSynthesis.cancel();
  if (ttsAudio) { ttsAudio.pause(); ttsAudio = null; }
  if (ttsUrl) { URL.revokeObjectURL(ttsUrl); ttsUrl = null; }
  if (state.speakingPanel === null && state.wordRange === null) return;
  state.speakingPanel = null;
  state.wordRange = null;
  render();
}

const enAccent = (lang) => (lang?.startsWith('en') ? state.englishAccent : undefined);
const sourceTtsLang = () => (state.sourceLang === 'auto' ? state.result.detected_lang : state.sourceLang);

// --- hotkey (display + recording) ------------------------------------------

const IS_MAC = tiny.system.isMacOS();

function formatHotkey(combo) {
  return combo.split('+').map((part) => {
    const p = part.toLowerCase();
    if (p === 'cmd') return IS_MAC ? 'Cmd' : 'Ctrl';
    if (p === 'ctrl') return 'Ctrl';
    if (p === 'alt') return IS_MAC ? 'Option' : 'Alt';
    if (p === 'shift') return 'Shift';
    if (p === 'win') return 'Win';
    return p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1);
  }).join('+');
}

const NAMED_KEYS = {
  Space: 'space', Enter: 'enter', Tab: 'tab', Backspace: 'backspace', Delete: 'delete',
  ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
  Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
  Comma: 'comma', Period: 'period',
};

function keyFromCode(code) {
  let m;
  if ((m = /^Key([A-Z])$/.exec(code))) return m[1].toLowerCase();
  if ((m = /^Digit(\d)$/.exec(code))) return m[1];
  if ((m = /^F(\d{1,2})$/.exec(code))) return 'f' + m[1];
  return NAMED_KEYS[code] ?? null;
}

async function captureHotkey(e) {
  e.preventDefault();
  if (e.key === 'Escape') { state.recordingHotkey = false; render(); return; }
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
  const mods = [];
  if (IS_MAC) {
    if (e.metaKey) mods.push('cmd');
    if (e.ctrlKey) mods.push('ctrl');
  } else {
    if (e.ctrlKey) mods.push('cmd'); // cmd ≡ Ctrl on Windows/Linux
    if (e.metaKey) mods.push('win');
  }
  if (e.altKey) mods.push('alt');
  if (e.shiftKey) mods.push('shift');
  if (!mods.length) return;
  const key = keyFromCode(e.code);
  state.recordingHotkey = false;
  if (!key) { state.hotkeyError = t('hotkeyFailed'); render(); return; }
  try {
    state.hotkey = await tiny.api.call('setHotkey', { combo: [...mods, key].join('+') });
    state.hotkeyError = '';
  } catch {
    state.hotkeyError = t('hotkeyFailed');
  }
  render();
}

// --- updates (useUpdater) ---------------------------------------------------

async function checkForUpdate() {
  state.update = { status: 'checking', latest: '', error: '' };
  render();
  try {
    const r = await tiny.api.call('update.check');
    state.update = r?.available
      ? { status: 'available', latest: r.latest, error: '' }
      : { status: 'up-to-date', latest: '', error: '' };
  } catch (e) {
    state.update = { status: 'error', latest: '', error: String(e?.message ?? e) };
  }
  render();
}

async function installUpdate() {
  state.update = { ...state.update, status: 'downloading' };
  render();
  try {
    await tiny.api.call('update.install'); // relaunches on success
  } catch (e) {
    state.update = { status: 'error', latest: '', error: String(e?.message ?? e) };
    render();
  }
}

// --- image → text (OCR) ------------------------------------------------------
// macOS: tinyjs's own tiny.macos.ocr (Vision). Windows: the backend calls the
// built-in Windows OCR (English + any installed OCR language pack). Linux:
// not available.

const IMAGE_RE = /\.(png|jpe?g|bmp|gif|tiff?)$/i;

async function translateImage(path) {
  if (tiny.system.isLinux()) {
    showOcrError(t('ocrUnsupported'));
    return;
  }
  state.ocrBusy = true;
  state.error = null;
  render();
  try {
    const { text } = IS_MAC ? await tiny.macos.ocr(path) : await tiny.api.call('ocr', { path });
    state.ocrBusy = false;
    const clean = (text ?? '').trim();
    if (!clean) { showOcrError(t('ocrNoText')); return; }
    state.sourceLang = 'auto';
    setSourceText(clean, true);
  } catch (e) {
    state.ocrBusy = false;
    showOcrError(t('ocrFailed') + (e?.message ? ` (${e.message})` : ''));
  }
}

function showOcrError(msg) {
  state.view = 'main';
  state.sourceText = '';
  sourceEl.value = '';
  state.result = { translated: '', detected_lang: '' };
  state.error = msg;
  render();
}

// Paste a screenshot (Win+Shift+S / Cmd+Ctrl+Shift+4, then Ctrl/Cmd+V).
// Plain text pastes go through untouched.
document.addEventListener('paste', async (e) => {
  const types = [...(e.clipboardData?.items ?? [])].map((i) => i.type);
  if (!types.some((t) => t.startsWith('image/')) || types.includes('text/plain')) return;
  e.preventDefault();
  const clip = await tiny.clipboard.read();
  if (clip.kind === 'image' && clip.image) translateImage(clip.image);
});

// Drop an image file on the window.
tiny.win.onDrop((paths) => {
  const img = paths.find((p) => IMAGE_RE.test(p));
  if (img) translateImage(img);
});

// --- actions -----------------------------------------------------------------

function canSwap() {
  const { translated, detected_lang } = state.result;
  return !!translated && (
    (state.sourceLang !== 'auto' && state.sourceLang !== state.targetLang) ||
    (state.sourceLang === 'auto' && !!detected_lang && detected_lang !== state.targetLang)
  );
}

function setSourceText(text, immediate = false) {
  state.sourceText = text;
  sourceEl.value = text;
  translate(immediate);
  render();
}

function setTargetLang(code) {
  state.targetLang = code;
  save('targetLang', code);
  translate(true);
  render();
}

function setSourceLang(code) {
  state.sourceLang = code;
  translate(true);
  render();
}

function setEngine(code) {
  state.engine = code;
  save('translationEngine', code);
  translate(true);
  render();
}

function swapLanguages() {
  if (!canSwap()) return;
  const detected = state.result.detected_lang;
  const effectiveSource = state.sourceLang === 'auto' ? (GOOGLE_CODE_MAP[detected] ?? detected) : state.sourceLang;
  state.sourceLang = state.targetLang;
  state.targetLang = effectiveSource;
  save('targetLang', effectiveSource);
  setSourceText(state.result.translated, true);
}

function setView(view) {
  state.view = view;
  if (view !== 'settings') state.recordingHotkey = false;
  render();
}

// --- DOM wiring --------------------------------------------------------------

const sourceEl = $('source-text');
const targetEl = $('target-text');

const sourceSelect = createLangSelect($('source-lang'), {
  getOptions: sourceLanguages, get: () => state.sourceLang, set: setSourceLang,
});
const targetSelect = createLangSelect($('target-lang'), {
  getOptions: displayLanguages, get: () => state.targetLang, set: setTargetLang,
});
const engineSelect = createLangSelect($('engine-select'), {
  getOptions: () => ENGINE_OPTIONS, get: () => state.engine, set: setEngine, small: true,
});
const defaultSelect = createLangSelect($('default-lang'), {
  getOptions: displayLanguages, get: () => state.targetLang, set: setTargetLang,
});

const appLangEl = $('app-lang');
for (const l of APP_LANGUAGES) appLangEl.add(new Option(l.label, l.code));
appLangEl.addEventListener('change', () => {
  locale = appLangEl.value;
  save('appLocale', locale);
  render();
});

sourceEl.addEventListener('input', () => {
  state.sourceText = sourceEl.value;
  translate();
  render();
});

$('btn-swap').addEventListener('click', swapLanguages);
$('btn-history').addEventListener('click', () => setView('history'));
$('btn-settings').addEventListener('click', () => setView('settings'));
$('btn-back').addEventListener('click', () => setView('main'));
$('btn-clear').addEventListener('click', () => setSourceText(''));
$('btn-clear-history').addEventListener('click', () => {
  state.history = [];
  saveHistory();
  render();
});

$('btn-copy').addEventListener('click', async () => {
  if (!state.result.translated) return;
  await tiny.clipboard.write({ text: state.result.translated });
  state.copied = true;
  render();
  setTimeout(() => { state.copied = false; render(); }, 1500);
});

$('speak-source').addEventListener('click', () => {
  if (state.speakingPanel === 'source') return stopSpeaking();
  const lang = sourceTtsLang();
  speak('source', state.sourceText, lang, enAccent(lang));
});
$('speak-target').addEventListener('click', () => {
  if (state.speakingPanel === 'target') return stopSpeaking();
  speak('target', state.result.translated, state.targetLang, enAccent(state.targetLang));
});

for (const btn of document.querySelectorAll('[data-accent]')) {
  btn.addEventListener('click', () => {
    state.englishAccent = btn.dataset.accent;
    save('englishAccent', state.englishAccent);
    render();
  });
}

const hotkeyBtn = $('hotkey-btn');
hotkeyBtn.addEventListener('click', () => {
  state.recordingHotkey = true;
  state.hotkeyError = '';
  render();
});
hotkeyBtn.addEventListener('keydown', (e) => { if (state.recordingHotkey) captureHotkey(e); });
hotkeyBtn.addEventListener('blur', () => {
  if (state.recordingHotkey) { state.recordingHotkey = false; render(); }
});

$('view-history').addEventListener('click', (e) => {
  const item = e.target.closest('.history-item');
  if (!item) return;
  const id = Number(item.dataset.id);
  if (e.target.closest('.history-delete')) {
    state.history = state.history.filter((h) => h.id !== id);
    saveHistory();
    render();
    return;
  }
  const entry = state.history.find((h) => h.id === id);
  if (!entry) return;
  state.sourceLang = entry.sourceLang;
  state.targetLang = entry.targetLang;
  state.engine = entry.engine;
  save('targetLang', entry.targetLang);
  save('translationEngine', entry.engine);
  state.view = 'main';
  setSourceText(entry.sourceText, true);
});

// --- render ------------------------------------------------------------------

function renderStatic() {
  document.documentElement.lang = locale;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  appLangEl.value = locale;
}

function renderSpeech() {
  for (const panel of ['source', 'target']) {
    const overlay = $('overlay-' + panel);
    const textarea = panel === 'source' ? sourceEl : targetEl;
    const active = state.speakingPanel === panel;
    overlay.hidden = !active;
    textarea.classList.toggle('text-speaking', active);
    $('speak-' + panel).classList.toggle('speaking', active);
    if (!active) continue;
    overlay.dir = textarea.dir;
    const text = panel === 'source' ? state.sourceText : state.result.translated;
    const r = state.wordRange;
    overlay.innerHTML = !r ? escapeHtml(text)
      : escapeHtml(text.slice(0, r.start)) + '<mark>' + escapeHtml(text.slice(r.start, r.end)) + '</mark>' + escapeHtml(text.slice(r.end));
  }
}

function renderHistory() {
  const el = $('view-history');
  if (!state.history.length) {
    el.innerHTML = `<div class="history-empty"><span>${escapeHtml(t('noHistory'))}</span><span class="history-hint">${escapeHtml(t('historyHint'))}</span></div>`;
    return;
  }
  el.innerHTML = '<div class="settings-group">' + state.history.map((h, i) => `
    <div class="history-item${i > 0 ? ' settings-row-bordered' : ''}" data-id="${h.id}">
      <div class="history-item-body">
        <div class="history-item-meta">
          <span class="history-lang-pair">${escapeHtml(langLabel(h.sourceLang, h.detectedLang))} → ${escapeHtml(langLabel(h.targetLang))}</span>
          <span class="history-engine">${escapeHtml(h.engine)}</span>
          <span class="history-time">${escapeHtml(relativeTime(h.timestamp))}</span>
        </div>
        <div class="history-source">${escapeHtml(h.sourceText)}</div>
        <div class="history-translated">${escapeHtml(h.translated)}</div>
      </div>
      <button class="btn-icon history-delete">✕</button>
    </div>`).join('') + '</div>';
}

function renderUpdate() {
  $('version-badge').textContent = state.version ? 'v' + state.version : '';
  const { status, latest, error } = state.update;
  const el = $('update-actions');
  if (status === 'checking') {
    el.innerHTML = `<span class="update-status-row"><span class="dot-pulse"></span>${escapeHtml(t('checking'))}</span>`;
    return;
  }
  if (status === 'downloading') {
    // tinyjs reports no download progress, so the bar is indeterminate
    el.innerHTML = `<div class="update-progress"><span class="update-status-row"><span class="dot-pulse"></span>${escapeHtml(t('downloading'))}</span><div class="progress-bar"><div class="progress-fill indeterminate"></div></div></div>`;
    return;
  }
  let html = '';
  if (status === 'up-to-date') html += `<span class="update-ok">${escapeHtml(t('upToDate'))}</span>`;
  if (status === 'available') html += `<span class="update-available">v${escapeHtml(latest)}</span>`;
  if (status === 'error') html += `<span class="update-error-msg" title="${escapeHtml(error)}">${escapeHtml(t('updateError'))}</span>`;
  html += status === 'available'
    ? `<button class="btn-install-update" data-act="install">${escapeHtml(t('installUpdate'))}</button>`
    : `<button class="btn-check-update" data-act="check">${escapeHtml(t('checkForUpdates'))}</button>`;
  el.innerHTML = html;
}
$('update-actions').addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'check') checkForUpdate();
  if (act === 'install') installUpdate();
});

function render() {
  renderStatic();
  const appDir = RTL_LANGS.has(locale) ? 'rtl' : 'ltr';
  $('app').dir = appDir;

  const main = state.view === 'main';
  $('hdr-main').hidden = !main;
  $('hdr-sub').hidden = main;
  $('view-main').hidden = !main;
  $('status-bar').hidden = !main;
  $('view-settings').hidden = state.view !== 'settings';
  $('view-history').hidden = state.view !== 'history';
  $('sub-title').textContent = state.view === 'settings' ? t('settings') : t('history');
  const showClearHistory = state.view === 'history' && state.history.length > 0;
  $('btn-clear-history').hidden = !showClearHistory;
  $('sub-spacer').hidden = showClearHistory;

  for (const s of [sourceSelect, targetSelect, engineSelect, defaultSelect]) s.refresh();
  $('btn-swap').disabled = !canSwap();

  // source panel
  const { translated, detected_lang } = state.result;
  sourceEl.dir = state.sourceText ? 'auto' : appDir;
  $('detected-lang').textContent = state.sourceLang === 'auto' && detected_lang
    ? `(${langLabel('auto', detected_lang)})` : '';
  $('speak-source').hidden = !(state.sourceText && sourceTtsLang());
  $('btn-clear').hidden = !state.sourceText;

  // target panel
  targetEl.dir = (translated || state.loading) ? (RTL_LANGS.has(state.targetLang) ? 'rtl' : 'ltr') : appDir;
  targetEl.value = state.error ?? (state.loading ? '' : translated);
  targetEl.style.color = state.error ? 'var(--error)' : '';
  targetEl.classList.toggle('loading', state.loading);
  targetEl.placeholder = state.loading ? t('translating') : t('translationPlaceholder');
  const hasResult = !!translated && !state.loading;
  $('speak-target').hidden = !hasResult;
  const copyBtn = $('btn-copy');
  copyBtn.hidden = !hasResult;
  copyBtn.classList.toggle('copied', state.copied);
  copyBtn.textContent = state.copied ? t('copied') : t('copy');
  copyBtn.title = state.copied ? t('copiedTitle') : t('copy');

  // status bar
  const busy = state.loading || state.ocrBusy;
  $('status-loading').hidden = !busy;
  $('status-loading-text').textContent = state.ocrBusy ? t('ocrReading') : t('translating');
  const hint = $('status-hint');
  hint.hidden = busy;
  const [before, after] = t('hintDesktop').split('{key}');
  hint.innerHTML = escapeHtml(before ?? '') + `<kbd>${escapeHtml(formatHotkey(state.hotkey))}</kbd>` + escapeHtml(after ?? '');

  // settings
  for (const btn of document.querySelectorAll('[data-accent]')) {
    btn.classList.toggle('active', btn.dataset.accent === state.englishAccent);
  }
  hotkeyBtn.classList.toggle('recording', state.recordingHotkey);
  hotkeyBtn.textContent = state.recordingHotkey ? t('hotkeyRecording') : formatHotkey(state.hotkey);
  const hkErr = $('hotkey-error');
  hkErr.hidden = !state.hotkeyError;
  hkErr.textContent = state.hotkeyError;
  renderUpdate();

  if (state.view === 'history') renderHistory();
  renderSpeech();
}

// --- backend events ----------------------------------------------------------

// Global hotkey: the backend copied the selection and showed the window.
tiny.api.on('translate-selection', ({ text }) => {
  state.view = 'main';
  if (!text) { render(); sourceEl.focus(); return; }
  state.sourceLang = 'auto';
  setSourceText(text, true);
});

tiny.api.on('window-hidden', () => {
  stopSpeaking();
  setSourceText('');
});

tiny.win.onState(({ focused }) => {
  if (focused && state.view !== 'main') setView('main');
});

tiny.win.setMinSize(400, 240);

tiny.api.call('getHotkey').then((h) => { state.hotkey = h; render(); });
tiny.api.call('appInfo').then(({ version }) => { state.version = version; render(); });

render();
