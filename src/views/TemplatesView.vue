<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type { FieldDef, FieldKind, ExtractStrategy, Template } from '../core/models'
import { plainClone } from '../core/models'
import { parseText } from '../core/parsers'
import { extractFromDocument } from '../core/extract'
import { useTemplatesStore } from '../stores/templates'
import { useUiStore } from '../stores/ui'
import { t } from '../locales/strings'
import AppIcon from '../components/AppIcon.vue'
import AppModal from '../components/AppModal.vue'
import AppSelect from '../components/AppSelect.vue'
import EmptyState from '../components/EmptyState.vue'

const store = useTemplatesStore()
const ui = useUiStore()

const selectedId = ref<string>(store.all[0]?.id ?? '')
const draft = reactive<Template>(plainClone(store.all[0] ?? { id: '', name: '', description: '', builtin: true, fields: [] }))
const sampleText = ref('')
const sampleResult = ref<{ name: string; value: string; conf: number }[] | null>(null)

watch(
  selectedId,
  () => {
    const tpl = store.byId(selectedId.value)
    if (tpl) Object.assign(draft, plainClone(tpl))
    sampleResult.value = null
  },
  { immediate: true },
)

const isBuiltin = computed(() => draft.builtin)
const dirty = computed(() => JSON.stringify(draft) !== JSON.stringify(store.byId(selectedId.value) ?? null))
const showDeleteConfirm = ref(false)

function select(id: string) {
  selectedId.value = id
}

function addField() {
  if (isBuiltin.value) return
  draft.fields.push({
    id: `uf_${crypto.randomUUID().slice(0, 8)}`,
    name: '',
    kind: 'text',
    strategy: 'auto',
  })
}

function removeField(i: number) {
  if (isBuiltin.value) return
  draft.fields.splice(i, 1)
}

function moveField(i: number, dir: -1 | 1) {
  const j = i + dir
  if (j < 0 || j >= draft.fields.length) return
  const [f] = draft.fields.splice(i, 1)
  draft.fields.splice(j, 0, f)
}

async function save() {
  if (isBuiltin.value) return
  const cleaned: Template = {
    ...draft,
    name: draft.name.trim() || t.common.untitled,
    fields: draft.fields.filter((f) => f.name.trim() !== ''),
  }
  if (store.byId(cleaned.id)) {
    await store.update(cleaned)
  } else {
    await store.create(cleaned)
  }
  Object.assign(draft, plainClone(cleaned))
  ui.toast(t.toast.templateSaved)
}

async function duplicateCurrent() {
  if (draft.id === '') return
  const copy = await store.duplicate(draft.id)
  if (copy) {
    ui.toast(t.templates.copied(copy.name))
    selectedId.value = copy.id
  }
}

function removeTemplate() {
  showDeleteConfirm.value = false
  void (async () => {
    await store.remove(draft.id)
    ui.toast(t.toast.templateDeleted)
    selectedId.value = store.all[0]?.id ?? ''
  })()
}

function runTest() {
  if (sampleText.value.trim() === '') return
  const doc = { fileName: '样例文本', kind: 'text' as const, blocks: parseText(sampleText.value) }
  const tpl: Template = { ...plainClone(draft), fields: draft.fields.filter((f) => f.name.trim() !== '') }
  const { entries } = extractFromDocument(doc.blocks, tpl, doc.fileName)
  const entry = entries[0]
  sampleResult.value = (entry ? tpl.fields : []).map((f: FieldDef) => ({
    name: f.name,
    value: entry?.values[f.id] === undefined ? '—' : String(entry.values[f.id]),
    conf: entry?.confidence[f.id] ?? 0,
  }))
}

async function newTemplate() {
  const tpl = await store.create({
    id: crypto.randomUUID(),
    name: t.common.untitled,
    description: '',
    fields: [
      { id: `uf_${crypto.randomUUID().slice(0, 8)}`, name: '标题', kind: 'text', strategy: 'auto' },
      { id: `uf_${crypto.randomUUID().slice(0, 8)}`, name: '日期', kind: 'date', strategy: 'auto' },
    ],
  } as Omit<Template, 'builtin'>)
  selectedId.value = tpl.id
}

const kindOptions = (['text', 'date', 'number', 'tag'] as FieldKind[]).map((k) => ({ value: k, label: t.templates.kinds[k] }))
const strategyOptions = (['auto', 'keyword', 'regex', 'heading', 'tableMap'] as ExtractStrategy[]).map((s) => ({ value: s, label: t.templates.strategies[s] }))
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1 class="large-title">{{ t.templates.title }}</h1>
      <div class="head-actions">
        <button class="btn" :disabled="draft.id === ''" @click="duplicateCurrent">
          <AppIcon name="copy" :size="15" />
          {{ t.templates.duplicateHere }}
        </button>
        <button class="btn btn-primary" @click="newTemplate">
          <AppIcon name="plus" :size="15" />
          {{ t.templates.newTemplate }}
        </button>
      </div>
    </header>

    <div class="layout">
      <aside class="list">
        <div class="group-label">{{ t.templates.builtinGroup }}</div>
        <button v-for="tpl in store.all.filter((x) => x.builtin)" :key="tpl.id" class="list-item" :class="{ on: selectedId === tpl.id }" @click="select(tpl.id)">
          {{ tpl.name }}
        </button>
        <div class="group-label">{{ t.templates.mineGroup }}</div>
        <button v-for="tpl in store.user" :key="tpl.id" class="list-item" :class="{ on: selectedId === tpl.id }" @click="select(tpl.id)">
          {{ tpl.name }}
        </button>
        <p v-if="store.user.length === 0" class="hint list-empty">{{ t.templates.newTemplate }}</p>
      </aside>

      <section class="editor">
        <div v-if="draft.id === ''" class="editor-empty">
          <EmptyState icon="layers" :title="t.templates.title" />
        </div>
        <template v-else>
          <p v-if="isBuiltin" class="builtin-note meta">{{ t.templates.builtinNote }}</p>

          <div class="form-row">
            <label>模板名称</label>
            <input v-model="draft.name" class="input" type="text" :disabled="isBuiltin" />
          </div>
          <div class="form-row">
            <label>说明</label>
            <input v-model="draft.description" class="input" type="text" :disabled="isBuiltin" />
          </div>

          <h2 class="section-title fields-title">{{ t.templates.fields }}</h2>
          <div v-if="draft.fields.length === 0" class="hint">{{ t.templates.noFields }}</div>
          <div v-for="(field, i) in draft.fields" :key="field.id" class="field-row">
            <input v-model="field.name" class="input name-input" type="text" :placeholder="t.templates.fieldName" :disabled="isBuiltin" />
            <AppSelect v-model="field.kind" :disabled="isBuiltin" :options="kindOptions" />
            <AppSelect v-model="field.strategy" :disabled="isBuiltin" :options="strategyOptions" />
            <input
              v-if="field.strategy === 'regex'"
              v-model="field.pattern"
              class="input extra-input"
              type="text"
              :placeholder="t.templates.patternPlaceholder"
              :disabled="isBuiltin"
            />
            <input
              v-else-if="field.strategy === 'keyword'"
              class="input extra-input"
              type="text"
              :placeholder="t.templates.keywordsPlaceholder"
              :disabled="isBuiltin"
              :value="field.keywords?.join('，') ?? ''"
              @change="field.keywords = ($event.target as HTMLInputElement).value.split(/[,，]/).map((s) => s.trim()).filter(Boolean)"
            />
            <div v-if="!isBuiltin" class="field-ops">
              <button class="icon-btn" :aria-label="t.common.back" @click="moveField(i, -1)"><AppIcon name="chevron-down" :size="14" style="transform: rotate(180deg)" /></button>
              <button class="icon-btn" :aria-label="t.common.back" @click="moveField(i, 1)"><AppIcon name="chevron-down" :size="14" /></button>
              <button class="icon-btn danger" :aria-label="t.common.remove" @click="removeField(i)"><AppIcon name="x" :size="14" /></button>
            </div>
          </div>
          <button v-if="!isBuiltin" class="btn add-field" @click="addField">
            <AppIcon name="plus" :size="14" />
            {{ t.templates.addField }}
          </button>

          <div class="editor-foot">
            <template v-if="isBuiltin">
              <span class="hint foot-hint">{{ t.templates.builtinNote }}</span>
            </template>
            <template v-else>
              <span class="hint foot-hint">{{ t.templates.userOpsHint }}</span>
              <span class="foot-ops">
                <button class="btn btn-danger" @click="showDeleteConfirm = true">
                  <AppIcon name="trash" :size="15" />
                  {{ t.common.delete }}
                </button>
                <button class="btn btn-primary" :disabled="!dirty" @click="save">{{ t.common.save }}</button>
              </span>
            </template>
          </div>

          <h2 class="section-title fields-title">{{ t.templates.testTitle }}</h2>
          <p class="hint">{{ t.templates.testDesc }}</p>
          <textarea v-model="sampleText" class="input sample-input" rows="4" placeholder="时间：2026年9月9日&#10;主题：示例会议" />
          <button class="btn" :disabled="sampleText.trim() === ''" @click="runTest">{{ t.templates.testRun }}</button>
          <div v-if="sampleResult" class="sample-result card">
            <div v-for="row in sampleResult" :key="row.name" class="sr-row">
              <span class="sr-name">{{ row.name }}</span>
              <span class="sr-value">{{ row.value }}</span>
              <span class="chip" :class="{ warn: row.conf < 0.6 }">{{ row.conf.toFixed(2) }}</span>
            </div>
          </div>
        </template>
      </section>
    </div>

    <!-- 删除模板的二次确认 -->
    <AppModal v-if="showDeleteConfirm" @close="showDeleteConfirm = false">
      <header class="modal-head">
        <h2>{{ t.templates.deleteTitle }}</h2>
        <button class="icon-btn" :aria-label="t.common.close" @click="showDeleteConfirm = false"><AppIcon name="x" /></button>
      </header>
      <div class="modal-body">
        <p>{{ t.templates.deleteDesc(draft.name) }}</p>
      </div>
      <footer class="modal-foot">
        <button class="btn" @click="showDeleteConfirm = false">{{ t.common.cancel }}</button>
        <button class="btn btn-danger" @click="removeTemplate">
          <AppIcon name="trash" :size="15" />
          {{ t.common.delete }}
        </button>
      </footer>
    </AppModal>
  </div>
</template>

<style scoped>
.page {
  padding: 28px 32px 48px;
  max-width: 1200px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.head-actions {
  display: flex;
  gap: 8px;
}

.editor-foot .foot-hint {
  flex: 1;
  min-width: 0;
  padding-right: 12px;
}

.editor-foot .foot-ops {
  display: flex;
  gap: 8px;
}

.layout {
  display: grid;
  grid-template-columns: 200px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

.list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.group-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-3);
  padding: 10px 10px 6px;
  letter-spacing: 0.04em;
}

.list-item {
  text-align: left;
  padding: 7px 10px;
  border-radius: var(--r-s);
  font-size: 13px;
  color: var(--ink-2);
  transition: background 150ms ease, color 150ms ease;
}

.list-item:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.list-item.on {
  background: var(--accent-soft);
  color: var(--accent);
  font-weight: 600;
}

.list-empty {
  padding: 4px 10px;
}

.editor {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--r-m);
  padding: 20px 22px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.builtin-note {
  background: var(--surface-2);
  border-radius: var(--r-s);
  padding: 8px 12px;
}

.fields-title {
  margin-top: 14px;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.name-input {
  flex: 0 1 140px;
}

.field-row .sel {
  flex: 0 0 auto;
  width: 110px;
}

.extra-input {
  flex: 1 1 180px;
  min-width: 140px;
}

.field-ops {
  display: flex;
  gap: 2px;
}

.add-field {
  align-self: flex-start;
}

.editor-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid var(--hairline);
}

.sample-input {
  margin-top: 4px;
}

.sample-result {
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sr-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.sr-name {
  flex: 0 0 90px;
  color: var(--ink-2);
  font-size: 12px;
}

.sr-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 860px) {
  .page {
    padding: 20px 16px 32px;
  }

  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
