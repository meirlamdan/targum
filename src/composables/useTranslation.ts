import { ref, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { translateText, type TranslateResult } from '../api/translate';

export function useTranslation(targetLang: Ref<string>, sourceLang: Ref<string>, engine: Ref<string>) {
  const { t } = useI18n();
  const result = ref<TranslateResult>({ translated: '', detected_lang: '' });
  const loading = ref(false);
  const error = ref<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  function translate(text: string, immediate = false) {
    if (timer) clearTimeout(timer);

    if (!text.trim()) {
      result.value = { translated: '', detected_lang: '' };
      error.value = null;
      return;
    }

    const delay = immediate ? 0 : 500;
    timer = setTimeout(async () => {
      loading.value = true;
      error.value = null;
      try {
        result.value = await translateText(
          text,
          targetLang.value,
          sourceLang.value,
          engine.value as 'google' | 'bing'
        );
      } catch (e) {
        error.value = e instanceof Error ? e.message : (typeof e === 'string' ? e : t('translationFailed'));
      } finally {
        loading.value = false;
      }
    }, delay);
  }

  return { result, loading, error, translate };
}
