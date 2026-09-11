<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{ wide?: boolean; /** 弹窗显隐：组件常驻，由 Transition 驱动进出动画 */ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.open) emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <!-- Transition 必须常驻：Teleport 的内容随 v-if 整体卸载时走独立卸载路径，
         leave 动画会被整段跳过（出场瞬间消失）。显隐交给 open，动画才能完整播放 -->
    <Transition name="sheet">
      <div v-if="open" class="modal-scrim" @click.self="emit('close')">
        <div class="modal-panel" :class="{ wide: props.wide }" role="dialog" aria-modal="true">
          <slot />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-head :deep(.icon-btn) {
  margin-right: -6px;
}
</style>
