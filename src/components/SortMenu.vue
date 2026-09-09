<script setup lang="ts">
import type { FieldDef } from '../core/models'
import type { SortDir } from '../core/query/filter'
import { t } from '../locales/strings'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  fields: FieldDef[]
  sort: { fieldId: string; dir: SortDir } | null
}>()

const emit = defineEmits<{ 'update:sort': [value: { fieldId: string; dir: SortDir } | null] }>()

/** 点击字段行循环：升序 → 降序 → 默认顺序 */
function cycle(field: FieldDef) {
  const current = props.sort
  if (!current || current.fieldId !== field.id) {
    emit('update:sort', { fieldId: field.id, dir: 'asc' })
  } else if (current.dir === 'asc') {
    emit('update:sort', { fieldId: field.id, dir: 'desc' })
  } else {
    emit('update:sort', null)
  }
}
</script>

<template>
  <div class="sort-panel">
    <header class="panel-head">
      <h3>{{ t.sortPanel.title }}</h3>
      <button v-if="props.sort" class="btn btn-ghost btn-sm" @click="emit('update:sort', null)">
        {{ t.sortPanel.clear }}
      </button>
    </header>

    <button class="sort-row" :class="{ on: !props.sort }" type="button" @click="emit('update:sort', null)">
      <span>{{ t.sortPanel.none }}</span>
    </button>
    <button
      v-for="field in props.fields"
      :key="field.id"
      class="sort-row"
      :class="{ on: props.sort?.fieldId === field.id }"
      type="button"
      @click="cycle(field)"
    >
      <span class="sort-name">{{ field.name }}</span>
      <span v-if="props.sort?.fieldId === field.id" class="sort-dir meta">
        {{ props.sort.dir === 'asc' ? t.library.sortAsc : t.library.sortDesc }}
        <AppIcon name="sort" :size="12" />
      </span>
    </button>
  </div>
</template>

<style scoped>
.sort-panel {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 320px;
  overflow-y: auto;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.panel-head h3 {
  font-size: 13px;
  font-weight: 600;
}

.btn-sm {
  height: 26px;
  padding: 0 10px;
  font-size: 12px;
}

.sort-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 10px;
  border-radius: var(--r-s);
  font-size: 13px;
  color: var(--ink-2);
  text-align: left;
  transition: background 150ms ease, color 150ms ease;
}

.sort-row:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.sort-row.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.sort-dir {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
</style>
