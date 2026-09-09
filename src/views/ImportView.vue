<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ACCEPTED_EXTENSIONS } from '../core/parsers'
import { useImporterStore } from '../stores/importer'
import { useLibrariesStore } from '../stores/libraries'
import { useTemplatesStore } from '../stores/templates'
import { useUiStore } from '../stores/ui'
import { t } from '../locales/strings'
import AppIcon from '../components/AppIcon.vue'
import ConfidenceBadge from '../components/ConfidenceBadge.vue'

const route = useRoute()
const router = useRouter()
const importer = useImporterStore()
const libraries = useLibrariesStore()
const templates = useTemplatesStore()
const ui = useUiStore()

const dragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const activeFileId = ref('')
const busy = ref(false)

onMounted(() => {
  const libId = route.query.lib
  if (typeof libId === 'string' && libraries.byId(libId)) {
    importer.targetMode = 'append'
    importer.targetLibId = libId
  }
  activeFileId.value = importer.files[0]?.id ?? ''
})

const step = computed(() => importer.step)
const canNext = computed(() => {
  switch (step.value) {
    case 1:
      return importer.parsedCount > 0
    case 2:
      return importer.parsedCount > 0
    case 3:
      return importer.templateId !== null
    case 4:
      return importer.allDrafts.length > 0
    case 5:
      return importer.targetMode === 'new' ? importer.newLibName.trim() !== '' || importer.files.length > 0 : importer.targetLibId !== ''
    default:
      return false
  }
})

const activeFile = computed(() => importer.files.find((f) => f.id === activeFileId.value) ?? importer.files.find((f) => f.doc) ?? null)
const lowCount = computed(() => {
  const f = activeFile.value
  if (!f) return 0
  return f.drafts.reduce((n, d) => n + Object.values(d.confidence).filter((c) => c < 0.6).length, 0)
})

function kindLabel(kind: 'docx' | 'xlsx' | 'text'): string {
  return kind === 'docx' ? t.import.kindDocx : kind === 'xlsx' ? t.import.kindXlsx : t.import.kindText
}

function pickFiles() {
  fileInput.value?.click()
}

async function onFilesChosen(list: FileList | null) {
  if (!list || list.length === 0) return
  await importer.addFiles(Array.from(list))
  activeFileId.value = importer.files[0]?.id ?? ''
}

function onDrop(e: DragEvent) {
  dragging.value = false
  void onFilesChosen(e.dataTransfer?.files ?? null)
}

function next() {
  if (step.value === 3) {
    // 进入提取步骤前已按模板重排各文件
    importer.step = 4
    return
  }
  importer.step = Math.min(5, importer.step + 1)
}

function prev() {
  importer.step = Math.max(1, importer.step - 1)
}

function chooseTemplate(id: string) {
  importer.prepareTemplate(id)
}

function reExtract() {
  importer.extractAll()
}

async function finish() {
  busy.value = true
  try {
    const result = await importer.commit()
    if (result) {
      ui.toast(t.import.imported(result.count, libraries.byId(result.libraryId)?.name ?? ''))
      importer.reset()
      router.push(`/library/${result.libraryId}`)
    }
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <button class="icon-btn" :aria-label="t.common.back" @click="router.back()">
        <AppIcon name="arrow-left" />
      </button>
      <h1 class="large-title">{{ t.import.title }}</h1>
    </header>

    <ol class="steps">
      <li v-for="(label, i) in t.import.steps" :key="label" :class="{ on: step === i + 1, done: step > i + 1 }">
        <span class="dot">{{ step > i + 1 ? '✓' : i + 1 }}</span>
        {{ label }}
      </li>
    </ol>

    <!-- 步骤 1：选择文件 -->
    <section v-if="step === 1" class="step-body">
      <div
        class="dropzone card"
        :class="{ drag: dragging }"
        role="button"
        tabindex="0"
        @click="pickFiles"
        @keydown.enter="pickFiles"
        @dragover.prevent="dragging = true"
        @dragleave="dragging = false"
        @drop.prevent="onDrop"
      >
        <AppIcon name="import" :size="28" />
        <h2>{{ t.import.dropTitle }}</h2>
        <p class="meta">{{ t.import.dropDesc }}</p>
        <input ref="fileInput" type="file" multiple :accept="ACCEPTED_EXTENSIONS" hidden @change="onFilesChosen(($event.target as HTMLInputElement)?.files ?? null)" />
      </div>

      <ul v-if="importer.files.length > 0" class="file-list">
        <li v-for="f in importer.files" :key="f.id" class="card file-item">
          <AppIcon :name="f.doc?.kind === 'xlsx' ? 'sheet' : f.doc?.kind === 'docx' ? 'doc' : 'text'" :size="17" />
          <div class="file-info">
            <span class="file-name">{{ f.file.name }}</span>
            <span v-if="f.error" class="meta error">{{ f.error }}</span>
            <span v-else-if="f.doc" class="meta">{{ kindLabel(f.doc.kind) }} · {{ f.doc.blocks.length }} 个内容块</span>
            <span v-else class="meta">解析中…</span>
          </div>
          <button class="icon-btn danger" :aria-label="t.import.removeFile" @click="importer.removeFile(f.id)">
            <AppIcon name="x" />
          </button>
        </li>
      </ul>
    </section>

    <!-- 步骤 2：识别结果 -->
    <section v-else-if="step === 2" class="step-body">
      <div v-for="f in importer.files" :key="f.id" class="card rec-card">
        <div class="rec-head">
          <AppIcon :name="f.doc?.kind === 'xlsx' ? 'sheet' : f.doc?.kind === 'docx' ? 'doc' : 'text'" :size="18" />
          <strong>{{ f.file.name }}</strong>
          <span v-if="f.doc" class="chip">{{ kindLabel(f.doc.kind) }}</span>
        </div>
        <p v-if="f.error" class="meta error">{{ f.error }}</p>
        <p v-else-if="f.doc" class="meta">
          识别出 {{ f.doc.blocks.length }} 个内容块
          · 标题 {{ f.doc.blocks.filter((b) => b.type === 'heading').length }}
          · 表格 {{ f.doc.blocks.filter((b) => b.type === 'table').length }}
          · 段落 {{ f.doc.blocks.filter((b) => b.type !== 'table').length }}
        </p>
      </div>
    </section>

    <!-- 步骤 3：选择模板 -->
    <section v-else-if="step === 3" class="step-body">
      <p class="meta step-note">{{ t.import.chooseTemplate }}</p>
      <div class="tpl-grid">
        <button
          v-for="tpl in templates.all"
          :key="tpl.id"
          class="card clickable tpl-card"
          :class="{ on: importer.templateId === tpl.id }"
          type="button"
          @click="chooseTemplate(tpl.id)"
        >
          <span class="tpl-name">{{ tpl.name }}</span>
          <span class="hint">{{ tpl.description }}</span>
          <span v-if="tpl.fields.length > 0" class="meta">{{ tpl.fields.length }} 个字段</span>
        </button>
      </div>
      <p class="hint step-note">{{ t.import.templateAutoNote }}</p>
    </section>

    <!-- 步骤 4：映射与提取确认 -->
    <section v-else-if="step === 4" class="step-body">
      <div v-if="importer.files.length > 1" class="file-tabs">
        <button
          v-for="f in importer.files.filter((x) => x.doc)"
          :key="f.id"
          class="file-tab"
          :class="{ on: activeFile?.id === f.id }"
          @click="activeFileId = f.id"
        >
          {{ f.file.name }}
        </button>
      </div>

      <template v-if="activeFile">
        <div class="card mode-card">
          <p class="mode-line">
            <AppIcon :name="activeFile.mode === 'table' ? 'table' : 'doc'" :size="15" />
            <strong>{{ activeFile.file.name }}</strong>
            {{ activeFile.mode === 'table' ? t.import.tableMode : activeFile.drafts.length > 1 ? t.import.logMode : t.import.documentMode }}
          </p>

          <div v-if="activeFile.mode === 'table' && activeFile.tableHeader" class="mapping">
            <div v-for="field in activeFile.inferred?.fields ?? []" :key="field.id" class="map-row">
              <span class="map-field">{{ field.name }}</span>
              <AppIcon name="chevron-right" :size="13" class="map-arrow" />
              <select v-model="activeFile.mapping[field.id]" class="select">
                <option :value="-1">（不导入）</option>
                <option v-for="(col, ci) in activeFile.tableHeader" :key="ci" :value="ci">{{ col || `列${ci + 1}` }}</option>
              </select>
            </div>
          </div>
          <p v-else class="hint">{{ t.import.editCellHint }}</p>
        </div>

        <div class="extract-bar">
          <button class="btn btn-primary" @click="reExtract">
            <AppIcon name="check" :size="15" />
            {{ activeFile.extracted ? t.import.reExtract : t.import.startExtract }}
          </button>
          <span v-if="activeFile.extracted" class="meta">
            {{ t.import.extracted(activeFile.drafts.length) }}
            <template v-if="lowCount > 0"> · <span class="low-note">{{ t.import.needConfirm(lowCount) }}</span></template>
          </span>
        </div>

        <div v-if="activeFile.extracted && activeFile.drafts.length > 0" class="drafts card">
          <table class="data-table">
            <thead>
              <tr>
                <th class="conf-col"></th>
                <th v-for="field in activeFile.inferred?.fields ?? []" :key="field.id">{{ field.name }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(draft, di) in activeFile.drafts.slice(0, 100)" :key="di">
                <td class="conf-col">
                  <span v-if="Object.values(draft.confidence).some((c) => c < 0.6)" class="chip warn">{{ t.import.lowConfidence }}</span>
                  <ConfidenceBadge v-else :conf="1" />
                </td>
                <td v-for="field in activeFile.inferred?.fields ?? []" :key="field.id">
                  <input
                    v-if="(draft.confidence[field.id] ?? 1) < 0.6"
                    v-model="draft.values[field.id]"
                    class="input cell-input"
                    type="text"
                  />
                  <span v-else class="cell-truncate">{{ draft.values[field.id] ?? '' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="activeFile.drafts.length > 100" class="hint drafts-more">仅显示前 100 条，其余会在入库时全部保存。</p>
        </div>
      </template>
    </section>

    <!-- 步骤 5：入库 -->
    <section v-else-if="step === 5" class="step-body">
      <div class="card target-card">
        <p class="meta">{{ t.import.target }} · 共 {{ importer.allDrafts.length }} 条</p>
        <label class="radio target-row">
          <input v-model="importer.targetMode" type="radio" value="new" />
          <span>{{ t.import.newLibrary }}</span>
          <input
            v-if="importer.targetMode === 'new'"
            v-model="importer.newLibName"
            class="input"
            type="text"
            :placeholder="t.import.libName"
          />
        </label>
        <label class="radio target-row">
          <input v-model="importer.targetMode" type="radio" value="append" />
          <span>{{ t.import.appendTo }}</span>
          <select v-if="importer.targetMode === 'append'" v-model="importer.targetLibId" class="select">
            <option v-for="lib in libraries.libraries" :key="lib.id" :value="lib.id">{{ lib.name }}（{{ lib.entries.length }} 条）</option>
          </select>
        </label>
      </div>
    </section>

    <footer class="wizard-foot">
      <button class="btn" :disabled="step === 1" @click="prev">{{ t.common.back }}</button>
      <button v-if="step < 5" class="btn btn-primary" :disabled="!canNext" @click="next">{{ t.common.next }}</button>
      <button v-else class="btn btn-primary" :disabled="!canNext || busy" @click="finish">
        <AppIcon name="check" :size="15" />
        {{ t.import.finish }}
      </button>
    </footer>
  </div>
</template>

<style scoped>
.page {
  padding: 28px 32px 48px;
  max-width: 1080px;
  display: flex;
  flex-direction: column;
  min-height: calc(100% - 0px);
}

.page-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.steps {
  display: flex;
  gap: 4px;
  list-style: none;
  margin: 0 0 20px;
  padding: 0;
  flex-wrap: wrap;
}

.steps li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-3);
  padding: 4px 10px 4px 4px;
  border-radius: 999px;
}

.steps li .dot {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--surface-2);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.steps li.on {
  color: var(--accent);
  font-weight: 600;
}

.steps li.on .dot {
  background: var(--accent);
  color: var(--accent-ink);
}

.steps li.done {
  color: var(--ink-2);
}

.step-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.dropzone {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 44px 24px;
  border-style: dashed;
  border-width: 1.5px;
  border-color: var(--hairline-strong);
  cursor: pointer;
  color: var(--ink-2);
  transition: border-color 150ms ease, background 150ms ease, transform 120ms ease;
}

.dropzone:hover,
.dropzone.drag {
  border-color: var(--accent);
  background: var(--accent-soft);
  color: var(--accent);
}

.dropzone h2 {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}

.file-list,
.rec-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
}

.file-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.file-name {
  font-weight: 500;
}

.error {
  color: var(--danger);
}

.rec-card {
  padding: 12px 16px;
}

.rec-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.rec-head .chip {
  margin-left: 4px;
}

.step-note {
  margin-top: 2px;
}

.tpl-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}

.tpl-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 14px 16px;
  text-align: left;
}

.tpl-card.on {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.tpl-name {
  font-weight: 600;
}

.mode-card {
  padding: 14px 16px;
}

.mode-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mapping {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.map-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.map-field {
  flex: 0 0 130px;
  font-weight: 500;
}

.map-arrow {
  color: var(--ink-3);
}

.map-row .select {
  flex: 0 0 200px;
}

.extract-bar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.low-note {
  color: var(--warn);
  font-weight: 600;
}

.drafts {
  overflow-x: auto;
}

.conf-col {
  width: 64px;
}

.cell-input {
  height: 26px;
  padding: 0 6px;
  font-size: 12.5px;
  min-width: 90px;
}

.drafts-more {
  padding: 8px 12px;
}

.target-card {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 520px;
}

.target-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}

.target-row .input,
.target-row .select {
  flex: 1;
}

.wizard-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
}

@media (max-width: 860px) {
  .page {
    padding: 20px 16px 32px;
  }

  .map-field {
    flex-basis: 90px;
  }
}
</style>
