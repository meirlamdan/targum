import { createI18n } from 'vue-i18n'
import en from './en'
import he from './he'

const savedLocale = localStorage.getItem('appLocale') ?? 'en'

export const i18n = createI18n({
  legacy: false,
  locale: savedLocale,
  fallbackLocale: 'en',
  messages: { en, he },
})

export const APP_LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'he', label: 'עברית' },
]
