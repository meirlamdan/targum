import { ref, computed } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getVersion } from '@tauri-apps/api/app';

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'up-to-date' | 'error';

interface UpdateInfo {
  version: string;
  body: string | null;
}

interface ProgressPayload {
  downloaded: number;
  total: number | null;
}

export function useUpdater() {
  const currentVersion = ref('');
  const updateStatus = ref<UpdateStatus>('idle');
  const updateInfo = ref<UpdateInfo | null>(null);
  const downloadProgress = ref<ProgressPayload | null>(null);
  const errorMessage = ref('');

  getVersion().then(v => { currentVersion.value = v; }).catch(() => {});

  const progressPercent = computed(() => {
    if (!downloadProgress.value?.total) return null;
    return Math.round((downloadProgress.value.downloaded / downloadProgress.value.total) * 100);
  });

  async function checkForUpdate() {
    updateStatus.value = 'checking';
    errorMessage.value = '';
    updateInfo.value = null;
    try {
      const result = await invoke<{ available: boolean; version?: string; body?: string }>('check_for_update');
      if (result.available) {
        updateInfo.value = { version: result.version!, body: result.body ?? null };
        updateStatus.value = 'available';
      } else {
        updateStatus.value = 'up-to-date';
      }
    } catch (e) {
      errorMessage.value = String(e);
      updateStatus.value = 'error';
    }
  }

  async function installUpdate() {
    updateStatus.value = 'downloading';
    downloadProgress.value = null;

    const unlisten = await listen<ProgressPayload>('update-progress', (event) => {
      downloadProgress.value = event.payload;
    });

    try {
      await invoke('install_update');
      unlisten();
    } catch (e) {
      unlisten();
      errorMessage.value = String(e);
      updateStatus.value = 'error';
    }
  }

  return {
    currentVersion,
    updateStatus,
    updateInfo,
    downloadProgress,
    progressPercent,
    errorMessage,
    checkForUpdate,
    installUpdate,
  };
}
