import { ref } from 'vue'
import { invoke } from '@tauri-apps/api/core'

const LANG_ALIASES: Record<string, string> = {
  iw: 'he',
  jw: 'jv',
}

function normalizeLang(lang: string): string {
  return LANG_ALIASES[lang] ?? lang
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.getVoices()
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    window.speechSynthesis.getVoices()
  })
}

function getBestVoice(lang: string, preferredLocale?: string): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  const base = lang.split('-')[0]
  if (preferredLocale && preferredLocale.split('-')[0] === base) {
    const exact = voices.find(v => v.lang === preferredLocale)
    if (exact) return exact
    const prefixed = voices.find(v => v.lang.startsWith(preferredLocale + '-'))
    if (prefixed) return prefixed
  }
  return (
    voices.find(v => v.lang === lang) ??
    voices.find(v => v.lang.startsWith(base + '-')) ??
    voices.find(v => v.lang.split('-')[0] === base) ??
    voices.find(v => v.lang.startsWith('en')) ??
    voices[0]
  )
}

// Returns true only if there is a system voice that actually speaks the requested language.
// Does not fall back to English — used to decide whether Web Speech or Google TTS is used.
function hasVoiceForLang(lang: string, preferredLocale?: string): boolean {
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return false
  const base = lang.split('-')[0]
  if (preferredLocale && preferredLocale.split('-')[0] === base) {
    if (voices.some(v => v.lang === preferredLocale || v.lang.startsWith(preferredLocale + '-'))) return true
  }
  return (
    voices.some(v => v.lang === lang) ||
    voices.some(v => v.lang.startsWith(base + '-')) ||
    voices.some(v => v.lang.split('-')[0] === base)
  )
}

export function useSpeech() {
  const speaking = ref(false)
  const wordRange = ref<{ start: number; end: number } | null>(null)
  let audioCtx: AudioContext | null = null
  let currentSource: AudioBufferSourceNode | null = null

  async function speak(text: string, lang: string, preferredLocale?: string) {
    if (!text.trim() || !lang) return
    stop()
    speaking.value = true

    const normalizedLang = normalizeLang(lang)

    // Tauri + no system voice for this language → Google TTS (audio only, no highlighting)
    if (isTauri && !hasVoiceForLang(normalizedLang, preferredLocale)) {
      const ttsLang = normalizeLang(preferredLocale ?? lang)
      try {
        const bytes = await invoke<number[]>('speak_tts', { text, lang: ttsLang })
        if (!bytes.length) { speaking.value = false; return }
        audioCtx ??= new AudioContext()
        const buffer = await audioCtx.decodeAudioData(new Uint8Array(bytes).buffer)
        const src = audioCtx.createBufferSource()
        currentSource = src
        src.buffer = buffer
        src.connect(audioCtx.destination)
        src.onended = () => {
          speaking.value = false
          wordRange.value = null
          if (currentSource === src) currentSource = null
        }
        src.start()
      } catch {
        speaking.value = false
      }
      return
    }

    // Web Speech API — browser mode, or Tauri when a matching system voice exists.
    // onboundary events give exact per-word timing → perfect highlighting.
    const utterance = new SpeechSynthesisUtterance(text)
    const voice = getBestVoice(normalizedLang, preferredLocale)
    if (voice) {
      utterance.voice = voice
      utterance.lang = voice.lang.split('-')[0] === normalizedLang.split('-')[0]
        ? normalizedLang
        : voice.lang
    } else {
      utterance.lang = normalizedLang
    }
    utterance.onboundary = (e: SpeechSynthesisEvent) => {
      if (e.name !== 'word') return
      const start = e.charIndex
      const rest = text.slice(start)
      const spaceIdx = rest.search(/\s/)
      const len = e.charLength || (spaceIdx === -1 ? rest.length : spaceIdx)
      wordRange.value = { start, end: start + len }
    }
    utterance.onend = () => { speaking.value = false; wordRange.value = null }
    utterance.onerror = () => { speaking.value = false; wordRange.value = null }
    window.speechSynthesis.speak(utterance)
  }

  function stop() {
    window.speechSynthesis?.cancel()
    if (isTauri) {
      try { currentSource?.stop() } catch { /* already ended */ }
      currentSource = null
    }
    speaking.value = false
    wordRange.value = null
  }

  return { speaking, speak, stop, wordRange }
}
