<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ /** 抽屉显隐：组件常驻，由 Transition 驱动进出动画 */ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <!-- Transition 常驻 + v-if="open"：Teleport 内容随组件整体卸载时 leave 动画会被跳过 -->
    <Transition name="slide">
      <div v-if="open">
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
  font-size: 1.6rem;
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

/* 进出场同路径：进 260ms 弹性曲线入场，出 180ms 加速离场 */
.slide-enter-active,
.slide-leave-active {
  transition: opacity 200ms ease;
}

.slide-leave-active {
  transition: opacity 140ms ease;
}

.slide-enter-active .drawer-panel {
  transition: transform 260ms var(--ease-sheet);
}

.slide-leave-active .drawer-panel {
  transition: transform 180ms cubic-bezier(0.4, 0, 1, 1);
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
