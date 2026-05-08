import { invoke } from '@tauri-apps/api/core';

export interface TranslateResult {
  translated: string;
  detected_lang: string;
}

export async function translateText(
  text: string,
  targetLang: string,
  sourceLang: string = 'auto',
  engine: 'google' | 'bing' | 'mymemory' = 'google'
): Promise<TranslateResult> {
  if (!text.trim()) return { translated: '', detected_lang: '' };

  if (engine === 'bing') {
    return invoke<TranslateResult>('translate_bing_text', { text, targetLang, sourceLang });
  }
  if (engine === 'mymemory') {
    return invoke<TranslateResult>('translate_mymemory_text', { text, targetLang, sourceLang });
  }
  return invoke<TranslateResult>('translate_text', { text, targetLang, sourceLang });
}
