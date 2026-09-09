<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FieldDef, FieldKind } from '../core/models'
import type { FilterRule, FilterState } from '../core/query/filter'
import { t } from '../locales/strings'
import AppIcon from './AppIcon.vue'

const props = defineProps<{ fields: FieldDef[]; state: FilterState }>()
const emit = defineEmits<{ 'update:state': [value: FilterState] }>()

const pickFieldId = ref('')
const draft = ref<{ from: string; to: string; min: string; max: string; text: string }>({
  from: '',
  to: '',
  min: '',
  max: '',
  text: '',
})

const pickField = computed<FieldDef | undefined>(() => props.fields.find((f) => f.id === pickFieldId.value))

function fieldLabel(kind: FieldKind): string {
  return t.templates.kinds[kind]
}

function addRule() {
  const field = pickField.value
  if (!field) return
  const id = crypto.randomUUID()
  let rule: FilterRule | null = null
  if (field.kind === 'date') {
    if (!draft.value.from && !draft.value.to) return
    rule = { id, fieldId: field.id, op: 'dateBetween', from: draft.value.from, to: draft.value.to }
  } else if (field.kind === 'number') {
    if (!draft.value.min && !draft.value.max) return
    rule = { id, fieldId: field.id, op: 'numberBetween', min: draft.value.min, max: draft.value.max }
  } else {
    if (!draft.value.text.trim()) return
    rule =
      field.kind === 'tag'
        ? { id, fieldId: field.id, op: 'isAnyOf', text: draft.value.text.trim() }
        : { id, fieldId: field.id, op: 'contains', text: draft.value.text.trim() }
  }
  emit('update:state', { ...props.state, rules: [...props.state.rules, rule] })
  draft.value = { from: '', to: '', min: '', max: '', text: '' }
  pickFieldId.value = ''
}

function removeRule(id: string) {
  emit('update:state', { ...props.state, rules: props.state.rules.filter((r) => r.id !== id) })
}

function clearAll() {
  emit('update:state', { search: props.state.search, rules: [] })
}

function ruleText(rule: FilterRule): string {
  const field = props.fields.find((f) => f.id === rule.fieldId)
  const name = field?.name ?? '?'
  switch (rule.op) {
    case 'dateBetween': {
      const parts = [rule.from && `${t.filterPanel.from} ${rule.from}`, rule.to && `${t.filterPanel.to} ${rule.to}`].filter(Boolean)
      return `${name} · ${parts.join(' ') || t.common.all}`
    }
    case 'numberBetween': {
      const parts = [rule.min !== '' && `≥ ${rule.min}`, rule.max !== '' && `≤ ${rule.max}`].filter(Boolean)
      return `${name} · ${parts.join(' ') || t.common.all}`
    }
    case 'contains':
      return `${name} · ${rule.text}`
    case 'isAnyOf':
      return `${name} · ${rule.text}`
  }
}
</script>

<template>
  <div class="filter-panel">
    <header class="panel-head">
      <h3>{{ t.filterPanel.title }}</h3>
      <button v-if="state.rules.length > 0" class="btn btn-ghost btn-sm" @click="clearAll">{{ t.filterPanel.clear }}</button>
    </header>

    <div v-if="state.rules.length > 0" class="rule-list">
      <span v-for="rule in state.rules" :key="rule.id" class="chip">
        {{ ruleText(rule) }}
        <button class="rule-x" :aria-label="t.common.remove" @click="removeRule(rule.id)">
          <AppIcon name="x" :size="12" />
        </button>
      </span>
    </div>

    <div class="rule-form">
      <select v-model="pickFieldId" class="select" :aria-label="t.filterPanel.pickField">
        <option value="" disabled>{{ t.filterPanel.pickField }}</option>
        <option v-for="field in props.fields" :key="field.id" :value="field.id">{{ field.name }}（{{ fieldLabel(field.kind) }}）</option>
      </select>

      <div v-if="pickField?.kind === 'date'" class="draft-row">
        <input v-model="draft.from" type="date" class="input" :aria-label="t.filterPanel.from" />
        <span class="hint">–</span>
        <input v-model="draft.to" type="date" class="input" :aria-label="t.filterPanel.to" />
      </div>
      <div v-else-if="pickField?.kind === 'number'" class="draft-row">
        <input v-model="draft.min" type="text" class="input" :placeholder="t.filterPanel.min" />
        <span class="hint">–</span>
        <input v-model="draft.max" type="text" class="input" :placeholder="t.filterPanel.max" />
      </div>
      <div v-else-if="pickField" class="draft-row">
        <input v-model="draft.text" type="text" class="input" :placeholder="pickField.kind === 'tag' ? t.filterPanel.anyOf : t.filterPanel.contains" />
      </div>

      <button class="btn btn-primary btn-sm" :disabled="!pickField" @click="addRule">{{ t.filterPanel.add }}</button>
    </div>
  </div>
</template>

<style scoped>
.filter-panel {
  padding: 14px 16px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
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

.rule-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.rule-x {
  display: inline-flex;
  margin-left: 2px;
  opacity: 0.7;
}

.rule-x:hover {
  opacity: 1;
}

.rule-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.rule-form .select {
  width: 100%;
}

.draft-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.draft-row .input {
  flex: 1;
}
</style>
