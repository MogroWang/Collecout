<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import AppIcon from './AppIcon.vue'

const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <Transition name="slide">
      <div>
        <div class="drawer-scrim" @click="emit('close')" />
        <div class="drawer-panel" role="dialog" aria-modal="true">
          <header class="drawer-head">
            <slot name="title" />
            <button class="icon-btn" aria-label="关闭" @click="emit('close')">
              <AppIcon name="x" />
            </button>
          </header>
          <div class="drawer-body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="drawer-foot">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--hairline);
}

.drawer-head h2 {
  font-size: 16px;
  font-weight: 600;
}

.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

.drawer-foot {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 20px 16px;
  border-top: 1px solid var(--hairline);
}

.slide-enter-active,
.slide-leave-active {
  transition: opacity 200ms ease;
}

.slide-enter-active .drawer-panel,
.slide-leave-active .drawer-panel {
  transition: transform 260ms var(--ease-sheet);
}

.slide-enter-from,
.slide-leave-to {
  opacity: 0;
}

.slide-enter-from .drawer-panel,
.slide-leave-to .drawer-panel {
  transform: translateX(40px);
}
</style>
