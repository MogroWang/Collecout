<script setup lang="ts">
import type { Entry, FieldDef } from '../core/models'

const props = defineProps<{
  fields: FieldDef[]
  entries: Entry[]
  selected: Set<string>
  sort: { fieldId: string; dir: 'asc' | 'desc' } | null
}>()

const emit = defineEmits<{
  select: [id: string, index: number, mod: { shift: boolean; meta: boolean }]
  'toggle-all': []
  sort: [fieldId: string]
  open: [id: string]
}>()

function display(field: FieldDef, entry: Entry): string {
  const v = entry.values[field.id]
  if (v === undefined || String(v) === '') return ''
  return String(v)
}

function onHeaderClick(field: FieldDef) {
  emit('sort', field.id)
}

function allSelected(): boolean {
  return props.entries.length > 0 && props.entries.every((e) => props.selected.has(e.id))
}

/** 勾选框：支持 Shift 范围选择与 Ctrl/Cmd 切换 */
function onCheck(entry: Entry, index: number, e: Event) {
  emit('select', entry.id, index, {
    shift: (e as MouseEvent).shiftKey,
    meta: (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey,
  })
}
</script>

<template>
  <table class="data-table">
    <thead>
      <tr>
        <th class="col-check">
          <input type="checkbox" :checked="allSelected()" aria-label="全选" @change="emit('toggle-all')" />
        </th>
        <th
          v-for="field in props.fields"
          :key="field.id"
          class="sortable"
          :class="{ sorted: props.sort?.fieldId === field.id }"
          @click="onHeaderClick(field)"
        >
          <span class="th-inner">
            {{ field.name }}
            <span v-if="props.sort?.fieldId === field.id" class="sort-mark">{{ props.sort.dir === 'asc' ? '↑' : '↓' }}</span>
          </span>
        </th>
      </tr>
    </thead>
    <tbody>
      <tr
        v-for="(entry, i) in props.entries"
        :key="entry.id"
        class="row-click"
        :class="{ selected: props.selected.has(entry.id) }"
        :data-entry-id="entry.id"
        @click="emit('open', entry.id)"
      >
        <td class="col-check" @click.stop>
          <input
            type="checkbox"
            :checked="props.selected.has(entry.id)"
            :aria-label="`选择 ${entry.id}`"
            @change="onCheck(entry, i, $event)"
          />
        </td>
        <td v-for="field in props.fields" :key="field.id">
          <span v-if="field.kind === 'tag' && display(field, entry)" class="chip">{{ display(field, entry) }}</span>
          <span v-else-if="field.kind === 'date'" class="cell-date">{{ display(field, entry) }}</span>
          <span v-else class="cell-truncate" :title="display(field, entry)">{{ display(field, entry) }}</span>
        </td>
      </tr>
    </tbody>
  </table>
</template>

<style scoped>
.col-check {
  width: 36px;
}

.col-check input {
  accent-color: var(--accent);
}

.th-inner {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.sort-mark {
  color: var(--accent);
  font-size: 11px;
}

.cell-date {
  font-variant-numeric: tabular-nums;
  color: var(--ink-2);
}
</style>
