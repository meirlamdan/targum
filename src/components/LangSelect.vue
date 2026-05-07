<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';

export interface LangOption {
  code: string;
  label: string;
}

const model = defineModel<string>({ required: true });

const props = defineProps<{
  options: LangOption[];
  small?: boolean;
}>();

const open = ref(false);
const triggerRef = ref<HTMLElement | null>(null);
const dropdownRef = ref<HTMLElement | null>(null);
const listMaxHeight = ref('220px');

const selected = computed(() =>
  props.options.find(o => o.code === model.value)?.label ?? model.value
);

function toggle() {
  if (!open.value && triggerRef.value) {
    const rect = triggerRef.value.getBoundingClientRect();
    const available = window.innerHeight - rect.bottom - 8;
    listMaxHeight.value = Math.min(220, Math.max(100, available)) + 'px';
  }
  open.value = !open.value;
}

function select(code: string) {
  model.value = code;
  open.value = false;
}

function onClickOutside(e: MouseEvent) {
  if (
    triggerRef.value && !triggerRef.value.contains(e.target as Node) &&
    dropdownRef.value && !dropdownRef.value.contains(e.target as Node)
  ) {
    open.value = false;
  }
}

onMounted(() => document.addEventListener('mousedown', onClickOutside));
onUnmounted(() => document.removeEventListener('mousedown', onClickOutside));
</script>

<template>
  <div class="ls-wrap" :class="{ small }">
    <button ref="triggerRef" class="ls-trigger" @click="toggle" type="button">
      <span class="ls-label">{{ selected }}</span>
      <span class="ls-arrow" :class="{ open }">▾</span>
    </button>
    <ul
      v-if="open"
      ref="dropdownRef"
      class="ls-list"
      :style="{ maxHeight: listMaxHeight, overflowY: 'auto', overflowX: 'hidden' }"
    >
      <li
        v-for="opt in options"
        :key="opt.code"
        class="ls-item"
        :class="{ active: opt.code === model }"
        @click="select(opt.code)"
      >
        {{ opt.label }}
      </li>
    </ul>
  </div>
</template>

<style scoped>
.ls-wrap {
  position: relative;
  display: inline-block;
}

.ls-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  font-size: 0.85rem;
  padding: 4px 8px;
  cursor: pointer;
  outline: none;
  white-space: nowrap;
}
.ls-trigger:focus { border-color: var(--primary); }

.small .ls-trigger {
  font-size: 0.75rem;
  padding: 2px 4px;
}

.ls-arrow {
  font-size: 0.7rem;
  color: var(--text-muted);
  transition: transform 0.15s;
  line-height: 1;
}
.ls-arrow.open { transform: rotate(180deg); }

.ls-list {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 999;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  list-style: none;
  margin: 0;
  padding: 4px 0;
  min-width: 100%;
  width: max-content;
}

.ls-item {
  padding: 5px 12px;
  font-size: 0.85rem;
  cursor: pointer;
  color: var(--text);
  white-space: nowrap;
}
.ls-item:hover { background: var(--border); }
.ls-item.active {
  color: var(--primary);
  font-weight: 600;
}
</style>
