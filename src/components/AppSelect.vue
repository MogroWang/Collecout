<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from './AppIcon.vue'

export interface SelectOption {
  value: string | number
  label: string
}

const props = defineProps<{
  modelValue: string | number
  options: SelectOption[]
  disabled?: boolean
  placeholder?: string
  /** 紧凑尺寸（表格行内） */
  compact?: boolean
  /** 触发器占比宽度拉伸 */
  grow?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string | number] }>()

const open = ref(false)
const activeIndex = ref(-1)
const trigger = ref<HTMLElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({})
const dropUp = ref(false)

const selected = computed(() => props.options.find((o) => o.value === props.modelValue))
const selectedLabel = computed(() => selected.value?.label ?? props.placeholder ?? '')

function layoutMenu() {
  const el = trigger.value
  if (!el) return
  const r = el.getBoundingClientRect()
  const menuH = Math.min(props.options.length * 32 + 12, 288)
  const below = window.innerHeight - r.bottom
  dropUp.value = below < menuH + 12 && r.top > menuH + 12
  menuStyle.value = {
    left: `${Math.min(r.left, window.innerWidth - 232 - 8)}px`,
    top: dropUp.value ? `${r.top - menuH - 6}px` : `${r.bottom + 6}px`,
    minWidth: `${r.width}px`,
  }
}

async function toggle() {
  if (props.disabled) return
  if (open.value) {
    close()
    return
  }
  open.value = true
  activeIndex.value = Math.max(0, props.options.findIndex((o) => o.value === props.modelValue))
  await nextTick()
  layoutMenu()
  menu.value?.focus()
  scrollActiveIntoView(false)
}

function close() {
  if (!open.value) return
  open.value = false
  trigger.value?.focus({ preventScroll: true })
}

function choose(opt: SelectOption) {
  emit('update:modelValue', opt.value)
  close()
}

function move(dir: -1 | 1) {
  if (!open.value) return
  const n = props.options.length
  if (n === 0) return
  activeIndex.value = (activeIndex.value + dir + n) % n
  scrollActiveIntoView(true)
}

function scrollActiveIntoView(smooth: boolean) {
  const el = menu.value?.children[activeIndex.value] as HTMLElement | undefined
  el?.scrollIntoView({ block: 'nearest', behavior: smooth ? 'smooth' : 'instant' })
}

function onKeydown(e: KeyboardEvent) {
  if (props.disabled) return
  switch (e.key) {
    case 'Enter':
    case ' ':
      e.preventDefault()
      if (open.value && activeIndex.value >= 0) choose(props.options[activeIndex.value])
      else void toggle()
      break
    case 'ArrowDown':
      e.preventDefault()
      open.value ? move(1) : void toggle()
      break
    case 'ArrowUp':
      e.preventDefault()
      open.value ? move(-1) : void toggle()
      break
    case 'Escape':
      if (open.value) {
        e.stopPropagation()
        close()
      }
      break
    case 'Tab':
      close()
      break
  }
}

function onOutside(e: PointerEvent) {
  if (!open.value) return
  if (trigger.value?.contains(e.target as Node) || menu.value?.contains(e.target as Node)) return
  close()
}

onMounted(() => document.addEventListener('pointerdown', onOutside, true))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside, true))
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="sel"
    :class="{ on: open, compact, grow }"
    :disabled="disabled"
    role="combobox"
    :aria-expanded="open"
    aria-haspopup="listbox"
    @keydown="onKeydown"
    @click="toggle"
  >
    <span class="sel-label" :class="{ ph: !selected }">{{ selectedLabel }}</span>
    <AppIcon name="chevron-down" :size="14" class="sel-chevron" />
  </button>

  <Teleport to="body">
    <Transition name="sel-pop">
      <div v-if="open" ref="menu" class="sel-menu" :style="menuStyle" :class="{ up: dropUp }" role="listbox" tabindex="-1"
        @keydown="onKeydown">
        <button
          v-for="(opt, i) in options"
          :key="opt.value"
          type="button"
          class="sel-opt"
          :class="{ pick: opt.value === modelValue, active: i === activeIndex }"
          role="option"
          :aria-selected="opt.value === modelValue"
          @pointerenter="activeIndex = i"
          @click="choose(opt)"
        >
          <span class="sel-opt-label">{{ opt.label }}</span>
          <AppIcon v-if="opt.value === modelValue" name="check" :size="14" />
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sel {
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  height: 32px;
  padding: 0 8px 0 10px;
  border: 1px solid var(--hairline-strong);
  border-radius: var(--r-s);
  background: var(--surface);
  color: var(--ink);
  font-weight: 400;
  min-width: 0;
  transition: border-color 150ms ease, box-shadow 150ms ease, background 120ms ease;
}

.sel.grow {
  flex: 1;
}

.sel.compact {
  height: 28px;
  font-size: 12.5px;
}

.sel:hover:not(:disabled) {
  border-color: var(--ink-3);
}

.sel.on {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.sel:disabled {
  opacity: 0.45;
  cursor: default;
}

.sel:active:not(:disabled) {
  background: var(--surface-2);
}

.sel-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sel-label.ph {
  color: var(--ink-3);
}

.sel-chevron {
  flex: none;
  color: var(--ink-3);
  transition: transform 180ms var(--ease-sheet);
}

.sel.on .sel-chevron {
  transform: rotate(180deg);
}

.sel-menu {
  position: fixed;
  z-index: 90;
  max-height: 288px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 5px;
  background: var(--elevated);
  border: 1px solid var(--hairline);
  border-radius: var(--r-m);
  box-shadow: var(--shadow-2);
  display: flex;
  flex-direction: column;
  gap: 1px;
  outline: none;
  transform-origin: top center;
}

.sel-menu.up {
  transform-origin: bottom center;
}

.sel-opt {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 28px;
  padding: 4px 9px;
  border-radius: var(--r-s);
  font-size: 13px;
  color: var(--ink);
  text-align: left;
}

.sel-opt.active {
  background: var(--surface-2);
}

.sel-opt.pick {
  color: var(--accent);
  font-weight: 600;
}

.sel-opt-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 打开：从触发器方向快速展开；关闭：原路收回 */
.sel-pop-enter-active {
  transition: opacity 150ms cubic-bezier(0.32, 0.72, 0, 1), transform 180ms var(--ease-sheet);
}

.sel-pop-leave-active {
  transition: opacity 110ms ease, transform 120ms ease-out;
}

.sel-pop-enter-from,
.sel-pop-leave-to {
  opacity: 0;
  transform: scaleY(0.94) translateY(-4px);
}

.sel-pop-enter-from.sel-menu.up,
.sel-pop-leave-to.sel-menu.up {
  transform: scaleY(0.94) translateY(4px);
}

@media (prefers-reduced-motion: reduce) {
  .sel-pop-enter-from,
  .sel-pop-leave-to {
    transform: none;
  }
}
</style>
