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

// Web Speech API voice preload — only needed in web/browser mode
if (!isTauri && typeof window !== 'undefined' && window.speechSynthesis) {
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

export function useSpeech() {
  const speaking = ref(false)
  const wordRange = ref<{ start: number; end: number } | null>(null)
  let audioCtx: AudioContext | null = null
  let currentSource: AudioBufferSourceNode | null = null

  async function speak(text: string, lang: string, preferredLocale?: string) {
    if (!text.trim() || !lang) return
    stop()
    speaking.value = true

    if (isTauri) {
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

    // Web/browser mode: Web Speech API
    const normalizedLang = normalizeLang(lang)
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
    if (isTauri) {
      try { currentSource?.stop() } catch { /* already ended */ }
      currentSource = null
    } else {
      window.speechSynthesis?.cancel()
    }
    speaking.value = false
    wordRange.value = null
  }

  return { speaking, speak, stop, wordRange }
}
