<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { invoke } from '@tauri-apps/api/core';

const startX = ref(0);
const startY = ref(0);
const currentX = ref(0);
const currentY = ref(0);
const isDragging = ref(false);
const processing = ref(false);

const selectionStyle = computed(() => {
  if (!isDragging.value && !processing.value) return { display: 'none' };
  const x = Math.min(startX.value, currentX.value);
  const y = Math.min(startY.value, currentY.value);
  const w = Math.abs(currentX.value - startX.value);
  const h = Math.abs(currentY.value - startY.value);
  return {
    left: x + 'px',
    top: y + 'px',
    width: w + 'px',
    height: h + 'px',
  };
});

const sizeLabel = computed(() => {
  if (!isDragging.value) return '';
  const w = Math.abs(currentX.value - startX.value);
  const h = Math.abs(currentY.value - startY.value);
  return `${w}×${h}`;
});

const sizeLabelStyle = computed(() => {
  const x = Math.min(startX.value, currentX.value);
  const y = Math.max(startY.value, currentY.value);
  const w = Math.abs(currentX.value - startX.value);
  return {
    left: (x + w) + 'px',
    top: y + 'px',
    transform: 'translate(-100%, 4px)',
  };
});

function onMouseDown(e: MouseEvent) {
  if (processing.value) return;
  isDragging.value = true;
  startX.value = e.clientX;
  startY.value = e.clientY;
  currentX.value = e.clientX;
  currentY.value = e.clientY;
}

function onMouseMove(e: MouseEvent) {
  if (!isDragging.value) return;
  currentX.value = e.clientX;
  currentY.value = e.clientY;
}

async function onMouseUp(e: MouseEvent) {
  if (!isDragging.value) return;
  isDragging.value = false;

  const x = Math.min(startX.value, e.clientX);
  const y = Math.min(startY.value, e.clientY);
  const w = Math.abs(e.clientX - startX.value);
  const h = Math.abs(e.clientY - startY.value);

  if (w < 10 || h < 10) return;

  processing.value = true;
  try {
    await invoke('capture_ocr_region', {
      x,
      y,
      w,
      h,
      scale: window.devicePixelRatio,
    });
  } finally {
    processing.value = false;
  }
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    isDragging.value = false;
    processing.value = false;
    invoke('hide_ocr_overlay');
  }
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));
</script>

<template>
  <div
    class="overlay"
    :class="{ processing }"
    @mousedown="onMouseDown"
    @mousemove="onMouseMove"
    @mouseup="onMouseUp"
  >
    <div class="instruction">
      <span v-if="processing" class="dot-pulse" />
      {{ processing ? 'Recognizing text…' : 'Drag to select a region' }}
    </div>

    <div class="selection-rect" :style="selectionStyle">
      <div class="handle tl" />
      <div class="handle tr" />
      <div class="handle bl" />
      <div class="handle br" />
    </div>

    <div v-if="isDragging && sizeLabel" class="size-badge" :style="sizeLabelStyle">
      {{ sizeLabel }}
    </div>

    <div class="cancel-hint">ESC to cancel</div>
  </div>
</template>

<style>
/* When running as OCR overlay, strip the global grey body background */
[data-window="ocr-overlay"],
[data-window="ocr-overlay"] body,
[data-window="ocr-overlay"] #app {
  background: transparent !important;
  margin: 0;
  padding: 0;
  height: 100vh;
  overflow: hidden;
}
</style>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.18);
  cursor: crosshair;
  user-select: none;
  -webkit-user-select: none;
}

.overlay.processing {
  cursor: wait;
}

.instruction {
  position: absolute;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  padding: 8px 18px;
  border-radius: 8px;
  font-size: 0.875rem;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 8px;
  pointer-events: none;
}

.selection-rect {
  position: absolute;
  border: 2px solid #0071e3;
  background: rgba(0, 113, 227, 0.08);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.15);
  pointer-events: none;
}

.handle {
  position: absolute;
  width: 7px;
  height: 7px;
  background: #0071e3;
  border-radius: 1px;
}

.handle.tl { top: -4px; left: -4px; }
.handle.tr { top: -4px; right: -4px; }
.handle.bl { bottom: -4px; left: -4px; }
.handle.br { bottom: -4px; right: -4px; }

.size-badge {
  position: absolute;
  background: rgba(0, 113, 227, 0.9);
  color: #fff;
  font-size: 0.7rem;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  padding: 2px 7px;
  border-radius: 4px;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
}

.cancel-hint {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 0, 0, 0.55);
  color: rgba(255, 255, 255, 0.7);
  font-size: 0.75rem;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  padding: 4px 12px;
  border-radius: 6px;
  pointer-events: none;
}

.dot-pulse {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #fff;
  animation: pulse 1s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(0.7); }
}
</style>
