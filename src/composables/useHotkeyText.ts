import { onMounted, onUnmounted } from 'vue';
import { listen } from '@tauri-apps/api/event';

export function useHotkeyText(onText: (text: string) => void) {
  let unlisten: (() => void) | null = null;

  onMounted(async () => {
    unlisten = await listen<string>('translate-selection', (event) => {
      onText(event.payload);
    });
  });

  onUnmounted(() => {
    unlisten?.();
  });
}
