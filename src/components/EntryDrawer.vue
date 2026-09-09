<script setup lang="ts">
import { reactive } from 'vue'
import type { Entry, EntryValue, Library, Template } from '../core/models'
import { t } from '../locales/strings'
import AppDrawer from './AppDrawer.vue'
import AppIcon from './AppIcon.vue'
import FieldInput from './FieldInput.vue'

const props = defineProps<{ library: Library; template: Template; entry: Entry }>()
const emit = defineEmits<{ close: []; save: [entry: Entry]; delete: [id: string] }>()

const draft = reactive({
  values: { ...props.entry.values } as Record<string, EntryValue | undefined>,
})

function save() {
  const values: Record<string, EntryValue> = {}
  for (const [k, v] of Object.entries(draft.values)) {
    if (v !== undefined) values[k] = v
  }
  emit('save', { ...props.entry, values })
}

function remove() {
  if (window.confirm(t.entryDrawer.deleteConfirm)) emit('delete', props.entry.id)
}

function isTitle(field: Template['fields'][number]): boolean {
  return field.kind === 'text' && /标题|主题|题目|书名|项目|name|title/i.test(field.name)
}
</script>

<template>
  <AppDrawer @close="emit('close')">
    <template #title>
      <h2>{{ t.entryDrawer.title }}</h2>
    </template>

    <div class="entry-form">
      <div v-for="field in props.template.fields" :key="field.id" class="form-row">
        <label>{{ field.name }}</label>
        <FieldInput
          :field="field"
          :model-value="draft.values[field.id]"
          :multiline="field.kind === 'text' && !isTitle(field)"
          @update:model-value="(v) => (draft.values[field.id] = v)"
        />
      </div>

      <p class="meta source-line">
        <AppIcon name="doc" :size="13" />
        {{ t.entryDrawer.sourceFrom(props.entry.sourceRef.fileName, props.entry.sourceRef.locator) }}
      </p>
    </div>

    <template #footer>
      <button class="btn btn-danger" @click="remove">
        <AppIcon name="trash" :size="15" />
        {{ t.common.delete }}
      </button>
      <button class="btn btn-primary" @click="save">{{ t.common.save }}</button>
    </template>
  </AppDrawer>
</template>

<style scoped>
.entry-form {
  display: flex;
  flex-direction: column;
}

.source-line {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  color: var(--ink-3);
}
</style>
