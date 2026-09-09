<script setup lang="ts">
import type { Entry, FieldDef } from '../core/models'

const props = defineProps<{
  fields: FieldDef[]
  entries: Entry[]
}>()

const emit = defineEmits<{ open: [id: string] }>()

function titleField(): FieldDef | undefined {
  return props.fields.find((f) => f.kind === 'text')
}

function detailFields(): FieldDef[] {
  const title = titleField()
  return props.fields.filter((f) => f !== title).slice(0, 5)
}

function value(field: FieldDef, entry: Entry): string {
  const v = entry.values[field.id]
  return v === undefined ? '' : String(v)
}
</script>

<template>
  <div class="card-grid">
    <article v-for="entry in props.entries" :key="entry.id" class="card clickable entry-card" @click="emit('open', entry.id)">
      <header class="card-head">
        <h3 class="card-title">{{ value(titleField() ?? ({ name: '条目' } as FieldDef), entry) || '未命名' }}</h3>
        <span v-if="entry.sourceRef.fileName" class="meta">{{ entry.sourceRef.fileName }}</span>
      </header>
      <dl class="card-rows">
        <template v-for="field in detailFields()" :key="field.id">
          <div v-if="value(field, entry) !== ''" class="card-row">
            <dt>{{ field.name }}</dt>
            <dd>
              <span v-if="field.kind === 'tag'" class="chip">{{ value(field, entry) }}</span>
              <span v-else class="row-value">{{ value(field, entry) }}</span>
            </dd>
          </div>
        </template>
      </dl>
    </article>
  </div>
</template>

<style scoped>
.card-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.entry-card {
  padding: 14px 16px;
}

.card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.card-title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-rows {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card-row {
  display: flex;
  gap: 10px;
  font-size: 12.5px;
  min-width: 0;
}

.card-row dt {
  flex: none;
  width: 52px;
  color: var(--ink-3);
}

.card-row dd {
  margin: 0;
  min-width: 0;
  color: var(--ink);
}

.row-value {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
