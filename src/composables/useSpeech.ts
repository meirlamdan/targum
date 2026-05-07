import { ref } from 'vue'

if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.getVoices()
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    window.speechSynthesis.getVoices()
  })
}

// Google Translate returns legacy codes that SpeechSynthesis doesn't recognise
const LANG_ALIASES: Record<string, string> = {
  iw: 'he',  // Hebrew
  jw: 'jv',  // Javanese
}

function normalizeLang(lang: string): string {
  return LANG_ALIASES[lang] ?? lang
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

  function speak(text: string, lang: string, preferredLocale?: string) {
    if (!text.trim() || !lang || !window.speechSynthesis) return
    stop()
    speaking.value = true
    const normalizedLang = normalizeLang(lang)
    const utterance = new SpeechSynthesisUtterance(text)
    const voice = getBestVoice(normalizedLang, preferredLocale)
    if (voice) {
      utterance.voice = voice
      // If we fell back to a different-language voice, align lang to avoid onerror
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
    speaking.value = false
    wordRange.value = null
  }

  return { speaking, speak, stop, wordRange }
}
