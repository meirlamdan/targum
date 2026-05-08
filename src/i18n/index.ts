import { createI18n } from 'vue-i18n'
import en from './en'
import he from './he'
import ru from './ru'
import fr from './fr'

const SUPPORTED_LOCALES = ['en', 'he', 'ru', 'fr']

function detectLocale(): string {
  const systemLang = navigator.language.split('-')[0]
  return SUPPORTED_LOCALES.includes(systemLang) ? systemLang : 'en'
}

const savedLocale = localStorage.getItem('appLocale') ?? detectLocale()

export const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'en',
  messages: { en, he, ru, fr },
})

export const APP_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'he', label: 'עברית' },
  { code: 'ru', label: 'Русский' },
  { code: 'fr', label: 'Français' },
]
