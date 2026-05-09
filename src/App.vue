<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue';
import { useI18n } from 'vue-i18n';
import { useTranslation } from './composables/useTranslation';
import { useHotkeyText } from './composables/useHotkeyText';
import { useSpeech } from './composables/useSpeech';
import { useUpdater } from './composables/useUpdater';
import { APP_LANGUAGES } from './i18n';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import LangSelect from './components/LangSelect.vue';

const { t, locale } = useI18n();

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
  { code: 'fa', label: 'فارסی' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'sv', label: 'Svenska' },
  { code: 'ro', label: 'Română' },
];

const RTL_LANGS = new Set(['he', 'ar', 'fa', 'ur']);

const SOURCE_LANGUAGES = computed(() => [
  { code: 'auto', label: t('autoDetect') },
  ...LANGUAGES,
]);

const SUPPORTED_LANG_CODES = new Set(LANGUAGES.map(l => l.code));
function systemDefaultLang(): string {
  const primary = navigator.language.split('-')[0].toLowerCase();
  return SUPPORTED_LANG_CODES.has(primary) ? primary : 'he';
}

const sourceText = ref('');
const targetLang = ref(localStorage.getItem('targetLang') ?? systemDefaultLang());
const sourceLang = ref('auto');
const engine = ref<'google' | 'bing' | 'mymemory'>((localStorage.getItem('translationEngine') as 'google' | 'bing' | 'mymemory') ?? 'google');
const ENGINE_OPTIONS = [{ code: 'google', label: 'Google' }, { code: 'bing', label: 'Bing' }, { code: 'mymemory', label: 'MyMemory' }];
const copied = ref(false);
const showSettings = ref(false);
const hasSpeech = typeof window !== 'undefined' && 'speechSynthesis' in window;
const appLocale = ref(locale.value);
const englishAccent = ref(localStorage.getItem('englishAccent') ?? 'en-US');

watch(appLocale, (lang) => {
  locale.value = lang;
  localStorage.setItem('appLocale', lang);
});

watch(englishAccent, (val) => {
  localStorage.setItem('englishAccent', val);
});

watch(engine, (val) => {
  localStorage.setItem('translationEngine', val);
  translate(sourceText.value, true);
});

const targetDir = computed(() => (RTL_LANGS.has(targetLang.value) ? 'rtl' : 'ltr'));
const appDir = computed(() => (RTL_LANGS.has(locale.value) ? 'rtl' : 'ltr'));
const sourcePanelDir = computed(() => sourceText.value ? 'auto' : appDir.value);
const targetPanelDir = computed(() => (result.value.translated || loading.value) ? targetDir.value : appDir.value);

const { result, loading, error, translate } = useTranslation(targetLang, sourceLang, engine);

const { speaking, speak, stop, wordRange } = useSpeech();
const speakingPanel = ref<'source' | 'target' | null>(null);
watch(speaking, (val) => { if (!val) speakingPanel.value = null; });

const sourceTtsLang = computed(() =>
  sourceLang.value === 'auto' ? result.value.detected_lang : sourceLang.value
);

function enAccent(lang: string | undefined): string | undefined {
  return lang?.startsWith('en') ? englishAccent.value : undefined;
}

function speakSource() {
  if (speakingPanel.value === 'source') { stop(); return; }
  speakingPanel.value = 'source';
  speak(sourceText.value, sourceTtsLang.value, enAccent(sourceTtsLang.value));
}

function speakTarget() {
  if (speakingPanel.value === 'target') { stop(); return; }
  speakingPanel.value = 'target';
  speak(result.value.translated, targetLang.value, enAccent(targetLang.value));
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const highlightedHtml = computed(() => {
  const panel = speakingPanel.value;
  if (!panel || !speaking.value) return '';
  const text = panel === 'source' ? sourceText.value : result.value.translated;
  if (!text) return '';
  if (!wordRange.value) return escapeHtml(text);
  const { start, end } = wordRange.value;
  return (
    escapeHtml(text.slice(0, start)) +
    `<mark>${escapeHtml(text.slice(start, end))}</mark>` +
    escapeHtml(text.slice(end))
  );
});

watch(sourceText, (text) => translate(text));
watch(targetLang, (lang) => {
  localStorage.setItem('targetLang', lang);
  translate(sourceText.value, true);
});
watch(sourceLang, () => translate(sourceText.value, true));

useHotkeyText((text) => {
  sourceLang.value = 'auto';
  sourceText.value = text;
  translate(text, true);
});

async function copyTranslation() {
  if (!result.value.translated) return;
  await navigator.clipboard.writeText(result.value.translated);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}

function clearAll() {
  sourceText.value = '';
}

const GOOGLE_CODE_MAP: Record<string, string> = { iw: 'he', jw: 'jv' };

const canSwap = computed(() =>
  !!result.value.translated && (
    (sourceLang.value !== 'auto' && sourceLang.value !== targetLang.value) ||
    (sourceLang.value === 'auto' && !!result.value.detected_lang && result.value.detected_lang !== targetLang.value)
  )
);

function swapLanguages() {
  if (!canSwap.value) return;
  const rawDetected = result.value.detected_lang;
  const effectiveSource = sourceLang.value === 'auto'
    ? (GOOGLE_CODE_MAP[rawDetected] ?? rawDetected)
    : sourceLang.value;
  sourceLang.value = targetLang.value;
  targetLang.value = effectiveSource;
  sourceText.value = result.value.translated;
}

const detectedLangLabel = computed(() => {
  if (!result.value.detected_lang) return '';
  const code = GOOGLE_CODE_MAP[result.value.detected_lang] ?? result.value.detected_lang;
  return LANGUAGES.find(l => l.code === code)?.label ?? result.value.detected_lang;
});

const currentHotkey = ref('Ctrl+Shift+T');
const recordingHotkey = ref(false);
const hotkeyError = ref('');

const {
  currentVersion,
  updateStatus,
  updateInfo,
  progressPercent,
  errorMessage: updateError,
  checkForUpdate,
  installUpdate,
} = useUpdater();

onMounted(() => {
  invoke<string>('get_hotkey').then(h => { currentHotkey.value = h; });

  listen('window-hidden', () => {
    sourceText.value = '';
  });

  getCurrentWindow().onFocusChanged(({ payload: focused }) => {
    if (focused) showSettings.value = false;
  });
});

function startRecording() {
  recordingHotkey.value = true;
  hotkeyError.value = '';
}

async function captureHotkey(e: KeyboardEvent) {
  e.preventDefault();
  if (e.key === 'Escape') {
    recordingHotkey.value = false;
    return;
  }
  const mods: string[] = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
  if (mods.length === 0) return;
  const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  const shortcut = [...mods, key].join('+');
  recordingHotkey.value = false;
  try {
    await invoke('set_hotkey', { shortcut });
    currentHotkey.value = shortcut;
    hotkeyError.value = '';
  } catch {
    hotkeyError.value = t('hotkeyFailed');
  }
}

function onHotkeyKeydown(e: KeyboardEvent) {
  if (recordingHotkey.value) captureHotkey(e);
}
</script>

<template>
  <div class="app" :dir="appDir">
    <header class="app-header">
      <!-- Normal mode -->
      <template v-if="!showSettings">
        <div class="header-start">
          <LangSelect v-model="sourceLang" :options="SOURCE_LANGUAGES" />
        </div>
        <button class="btn-swap" @click="swapLanguages" :disabled="!canSwap" :title="t('swapLanguages')">⇄</button>
        <div class="header-end">
          <LangSelect v-model="targetLang" :options="LANGUAGES" />
          <div class="header-end-spacer" />
          <LangSelect v-model="engine" :options="ENGINE_OPTIONS" small />
          <button class="btn-icon" @click="showSettings = true" :title="t('settings')">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
        </div>
      </template>

      <!-- Settings mode -->
      <template v-else>
        <button class="btn-icon btn-back" @click="showSettings = false" :title="t('back')">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
        <span class="app-title">{{ t('settings') }}</span>
        <div class="header-spacer" />
      </template>
    </header>

    <!-- Settings content -->
    <div v-if="showSettings" class="settings-content">
      <div class="settings-group">
        <div class="settings-row">
          <label class="settings-label" for="default-lang">{{ t('defaultLang') }}</label>
          <LangSelect v-model="targetLang" :options="LANGUAGES" />
        </div>
        <div class="settings-row settings-row-bordered">
          <label class="settings-label" for="app-lang">{{ t('appLanguage') }}</label>
          <select id="app-lang" v-model="appLocale" class="lang-select">
            <option v-for="lang in APP_LANGUAGES" :key="lang.code" :value="lang.code">
              {{ lang.label }}
            </option>
          </select>
        </div>
        <div class="settings-row settings-row-bordered">
          <label class="settings-label">{{ t('englishAccent') }}</label>
          <div class="engine-toggle">
            <button :class="['btn-engine', { active: englishAccent === 'en-US' }]" @click="englishAccent = 'en-US'">{{ t('accentAmerican') }}</button>
            <button :class="['btn-engine', { active: englishAccent === 'en-GB' }]" @click="englishAccent = 'en-GB'">{{ t('accentBritish') }}</button>
          </div>
        </div>
        <div class="settings-row settings-row-bordered">
          <label class="settings-label">{{ t('hotkey') }}</label>
          <div class="hotkey-field">
            <button
              class="hotkey-btn"
              :class="{ recording: recordingHotkey }"
              @click="startRecording"
              @keydown="onHotkeyKeydown"
              @blur="recordingHotkey = false"
            >
              {{ recordingHotkey ? t('hotkeyRecording') : currentHotkey }}
            </button>
            <div v-if="hotkeyError" class="hotkey-error">{{ hotkeyError }}</div>
          </div>
        </div>
        <div class="settings-row settings-row-bordered">
          <div class="settings-label-group">
            <span class="settings-label">{{ t('updates') }}</span>
            <span v-if="currentVersion" class="version-badge">v{{ currentVersion }}</span>
          </div>
          <div class="update-actions">
            <template v-if="updateStatus === 'checking'">
              <span class="update-status-row"><span class="dot-pulse" />{{ t('checking') }}</span>
            </template>
            <template v-else-if="updateStatus === 'downloading'">
              <div class="update-progress">
                <span class="update-status-row"><span class="dot-pulse" />{{ t('downloading') }}</span>
                <div class="progress-bar">
                  <div class="progress-fill" :style="{ width: (progressPercent ?? 0) + '%' }" />
                </div>
              </div>
            </template>
            <template v-else>
              <span v-if="updateStatus === 'up-to-date'" class="update-ok">{{ t('upToDate') }}</span>
              <span v-if="updateStatus === 'available'" class="update-available">v{{ updateInfo?.version }}</span>
              <span v-if="updateStatus === 'error'" class="update-error-msg" :title="updateError">{{ t('updateError') }}</span>
              <button
                v-if="updateStatus !== 'available'"
                class="btn-check-update"
                @click="checkForUpdate"
              >{{ t('checkForUpdates') }}</button>
              <button
                v-if="updateStatus === 'available'"
                class="btn-install-update"
                @click="installUpdate"
              >{{ t('installUpdate') }}</button>
            </template>
          </div>
        </div>
      </div>
    </div>

    <main v-if="!showSettings" class="panels">
      <!-- Source panel -->
      <div class="panel source-panel">
        <div class="panel-toolbar">
          <span class="panel-label">
            {{ t('source') }}
            <span v-if="sourceLang === 'auto' && result.detected_lang" class="detected-lang">
              ({{ detectedLangLabel }})
            </span>
          </span>
          <div class="toolbar-actions">
            <button v-if="hasSpeech && sourceText && sourceTtsLang" class="btn-speak" :class="{ speaking: speakingPanel === 'source' }" @click="speakSource" :title="t('speak')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 9v6h4l5 5V4L7 9H3z"/>
                <path d="M16.5 12A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z"/>
                <path d="M19 12a7 7 0 0 0-5-6.71v1.52A5.5 5.5 0 0 1 17.5 12a5.5 5.5 0 0 1-3.5 5.19v1.52A7 7 0 0 0 19 12z"/>
              </svg>
            </button>
            <button v-if="sourceText" class="btn-clear" @click="clearAll" :title="t('clear')">✕</button>
          </div>
        </div>
        <textarea
          v-model="sourceText"
          class="panel-textarea"
          :class="{ 'text-speaking': speakingPanel === 'source' }"
          :placeholder="t('placeholder')"
          :dir="sourcePanelDir"
          spellcheck="false"
          autofocus
        />
        <div
          v-if="speakingPanel === 'source'"
          class="speak-overlay"
          :dir="sourcePanelDir"
          v-html="highlightedHtml"
        />
      </div>

      <div class="panel-divider" />

      <!-- Translation panel -->
      <div class="panel target-panel">
        <div class="panel-toolbar">
          <span class="panel-label">{{ t('translation') }}</span>
          <div class="toolbar-actions">
            <button v-if="hasSpeech && result.translated && !loading" class="btn-speak" :class="{ speaking: speakingPanel === 'target' }" @click="speakTarget" :title="t('speak')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 9v6h4l5 5V4L7 9H3z"/>
                <path d="M16.5 12A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4z"/>
                <path d="M19 12a7 7 0 0 0-5-6.71v1.52A5.5 5.5 0 0 1 17.5 12a5.5 5.5 0 0 1-3.5 5.19v1.52A7 7 0 0 0 19 12z"/>
              </svg>
            </button>
            <button
              v-if="result.translated && !loading"
              class="btn-copy"
              :class="{ copied }"
              @click="copyTranslation"
              :title="copied ? t('copiedTitle') : t('copy')"
            >
              {{ copied ? t('copied') : t('copy') }}
            </button>
          </div>
        </div>
        <textarea
          class="panel-textarea target-textarea"
          :class="{ loading, 'text-speaking': speakingPanel === 'target' }"
          :value="error ?? (loading ? '' : result.translated)"
          :dir="targetPanelDir"
          :style="error ? { color: 'var(--error)' } : {}"
          readonly
          :placeholder="loading ? t('translating') : t('translationPlaceholder')"
        />
        <div
          v-if="speakingPanel === 'target'"
          class="speak-overlay"
          :dir="targetPanelDir"
          v-html="highlightedHtml"
        />
      </div>
    </main>

    <footer v-if="!showSettings" class="status-bar">
      <span v-if="loading" class="status-loading">
        <span class="dot-pulse" />
        {{ t('translating') }}
      </span>
      <span v-else class="status-hint">
        <i18n-t keypath="hintDesktop">
          <template #key><kbd>{{ currentHotkey }}</kbd></template>
        </i18n-t>
      </span>
    </footer>
  </div>
</template>

<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #f5f5f7;
  --surface: #ffffff;
  --border: #d1d1d6;
  --primary: #0071e3;
  --primary-hover: #0077ed;
  --text: #1d1d1f;
  --text-muted: #6e6e73;
  --error: #ff3b30;
  --radius: 10px;
  --copy-success: #34c759;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  font-size: 15px;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1c1c1e;
    --surface: #2c2c2e;
    --border: #3a3a3c;
    --text: #f5f5f7;
    --text-muted: #98989d;
    --primary: #0a84ff;
    --primary-hover: #409cff;
  }
}

body { background: var(--bg); color: var(--text); height: 100vh; overflow: hidden; }
#app { height: 100vh; }

.app {
  display: grid;
  grid-template-rows: auto 1fr auto;
  height: 100vh;
  background: var(--bg);
}

/* Header */
.app-header {
  display: grid;
  grid-template-columns: 1fr auto 1fr;
  align-items: center;
  padding: 12px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  gap: 12px;
}

.app-title {
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.header-start {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.btn-swap {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 1rem;
  line-height: 1;
  padding: 2px 6px;
  transition: background 0.15s, color 0.15s;
}
.btn-swap:hover:not(:disabled) { background: var(--border); color: var(--text); }
.btn-swap:disabled { opacity: 0.35; cursor: default; }

.lang-select {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 0.85rem;
  padding: 4px 8px;
  cursor: pointer;
  outline: none;
}

.lang-select:focus { border-color: var(--primary); }

/* Panels */
.panels {
  display: grid;
  grid-template-columns: 1fr 1px 1fr;
  overflow: hidden;
}

.panel-divider { background: var(--border); }

.panel {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--surface);
  position: relative;
}

.panel-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border);
  height: 36px;
}

.panel-label {
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.detected-lang {
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
}

.panel-textarea {
  flex: 1;
  border: none;
  outline: none;
  resize: none;
  padding: 14px;
  font-size: 1rem;
  line-height: 1.6;
  background: transparent;
  color: var(--text);
  font-family: inherit;
}

.panel-textarea::placeholder { color: var(--text-muted); }

.target-textarea { color: var(--text); }
.target-textarea.loading { opacity: 0.4; }
.target-textarea::placeholder { text-align: start; }

/* Buttons */
.btn-clear, .btn-copy {
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 500;
  line-height: 1;
  padding: 3px 10px;
  transition: background 0.15s, color 0.15s;
}

.btn-clear {
  background: transparent;
  color: var(--text-muted);
}
.btn-clear:hover { background: var(--border); color: var(--text); }

.btn-copy {
  background: var(--primary);
  color: #fff;
}
.btn-copy:hover { background: var(--primary-hover); }
.btn-copy.copied { background: var(--copy-success); }

/* Status bar */
.status-bar {
  padding: 6px 16px;
  border-top: 1px solid var(--border);
  background: var(--surface);
  font-size: 0.75rem;
  color: var(--text-muted);
  min-height: 28px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-loading { display: flex; align-items: center; gap: 6px; }

.dot-pulse {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary);
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}

kbd {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: monospace;
  font-size: 0.72rem;
}

/* Settings */
.btn-icon {
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--text-muted);
  padding: 5px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  font-size: 0.82rem;
  transition: background 0.15s, color 0.15s;
}
.btn-icon:hover { background: var(--border); color: var(--text); }

[dir="rtl"] .btn-back svg { transform: scaleX(-1); }

.settings-content {
  flex: 1;
  padding: 20px 20px;
  background: var(--bg);
  overflow-y: auto;
}

.settings-group {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 11px 14px;
  gap: 12px;
}

.settings-label {
  font-size: 0.9rem;
  color: var(--text);
}

.settings-row-bordered {
  border-top: 1px solid var(--border);
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.text-speaking { opacity: 0; pointer-events: none; }

.speak-overlay {
  position: absolute;
  top: 36px;
  left: 0; right: 0; bottom: 0;
  padding: 14px;
  font-size: 1rem;
  line-height: 1.6;
  color: var(--text);
  white-space: pre-wrap;
  word-break: break-word;
  overflow-y: auto;
  font-family: inherit;
}

.speak-overlay mark {
  background: var(--primary);
  color: #fff;
  border-radius: 3px;
  padding: 0 2px;
}

.btn-speak {
  background: transparent;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.88rem;
  line-height: 1;
  padding: 3px 6px;
  color: var(--text-muted);
  transition: background 0.15s, color 0.15s;
}
.btn-speak:hover { background: var(--border); color: var(--text); }
.btn-speak.speaking { color: var(--primary); animation: speak-pulse 1s ease-in-out infinite; }

@keyframes speak-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}

.header-end {
  display: flex;
  align-items: center;
  gap: 6px;
}

.header-end-spacer { flex: 1; }


.engine-toggle {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
  width: fit-content;
}

.btn-engine {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 0.7rem;
  font-weight: 500;
  padding: 2px 8px;
  color: var(--text-muted);
  transition: background 0.15s, color 0.15s;
  line-height: 1.4;
}
.btn-engine.active { background: var(--primary); color: #fff; }
.btn-engine:not(.active):hover { background: var(--border); color: var(--text); }

.hotkey-field {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.hotkey-btn {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  cursor: pointer;
  font-family: monospace;
  font-size: 0.85rem;
  padding: 4px 10px;
  outline: none;
  transition: border-color 0.15s;
}
.hotkey-btn:hover { border-color: var(--primary); }
.hotkey-btn.recording {
  border-color: var(--primary);
  color: var(--text-muted);
  box-shadow: 0 0 0 3px rgba(0, 113, 227, 0.2);
}

.hotkey-error {
  font-size: 0.75rem;
  color: var(--error);
}

.settings-label-group {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.version-badge {
  font-size: 0.72rem;
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;
}

.update-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.update-status-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  color: var(--text-muted);
}

.update-ok {
  font-size: 0.82rem;
  color: var(--copy-success);
}

.update-available {
  font-size: 0.82rem;
  color: var(--primary);
  font-weight: 500;
}

.update-error-msg {
  font-size: 0.82rem;
  color: var(--error);
  cursor: default;
}

.update-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-end;
}

.progress-bar {
  width: 100px;
  height: 4px;
  background: var(--border);
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--primary);
  border-radius: 2px;
  transition: width 0.2s ease;
  min-width: 8px;
}

.btn-check-update {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 500;
  padding: 3px 10px;
  transition: border-color 0.15s, background 0.15s;
}
.btn-check-update:hover { border-color: var(--primary); background: var(--surface); }

.btn-install-update {
  background: var(--primary);
  border: none;
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  font-size: 0.78rem;
  font-weight: 500;
  padding: 3px 10px;
  transition: background 0.15s;
}
.btn-install-update:hover { background: var(--primary-hover); }
</style>
