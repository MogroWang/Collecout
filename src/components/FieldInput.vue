<script setup lang="ts">
import type { EntryValue, FieldDef } from '../core/models'
import { normalizeNumberValue } from '../core/extract'

const props = defineProps<{ field: FieldDef; modelValue: EntryValue | undefined; multiline?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: EntryValue | undefined] }>()

function onText(e: Event) {
  const raw = (e.target as HTMLInputElement).value
  if (raw === '') {
    emit('update:modelValue', undefined)
    return
  }
  if (props.field.kind === 'number') {
    const n = normalizeNumberValue(raw)
    emit('update:modelValue', n === null ? raw : n)
    return
  }
  emit('update:modelValue', raw)
}
</script>

<template>
  <textarea
    v-if="props.multiline"
    class="input"
    rows="3"
    :value="props.modelValue === undefined ? '' : String(props.modelValue)"
    :placeholder="props.field.kind === 'date' ? '2026-09-09' : props.field.name"
    @input="onText"
  />
  <input
    v-else-if="props.field.kind === 'date'"
    type="date"
    class="input"
    :value="props.modelValue === undefined ? '' : String(props.modelValue)"
    @input="onText"
  />
  <input
    v-else
    class="input"
    :inputmode="props.field.kind === 'number' ? 'decimal' : undefined"
    :value="props.modelValue === undefined ? '' : String(props.modelValue)"
    :placeholder="props.field.name"
    @input="onText"
  />
</template>
