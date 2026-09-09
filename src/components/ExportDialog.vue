<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Entry, ExportFormat, Library, Template } from '../core/models'
import { exportCsv, exportJson, exportMarkdown, exportPlainText, type TextExportStyle } from '../core/export'
import { exportFolderPlan } from '../core/export'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'
import { t } from '../locales/strings'
import { isDesktop } from '../lib/platform'
import { copyToClipboard, downloadText, mkdirAbsolute, pickDirectory, pickSavePath, revealInFinder, writeTextAbsolute } from '../lib/desktop'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  library: Library
  template: Template
  all: Entry[]
  filtered: Entry[]
  selected: Entry[]
}>()

const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()
const ui = useUiStore()

const scope = ref<'all' | 'filtered' | 'selected'>('all')
const chosenFields = ref<string[]>(props.template.fields.map((f) => f.id))
const format = ref<ExportFormat>(settings.settings.defaultExportFormat)
const textStyle = ref<TextExportStyle>('tsv')
const exportedPath = ref<string | null>(null)
const exportedIsDir = ref(false)

const entries = computed<Entry[]>(() => {
  if (scope.value === 'selected') return props.selected
  if (scope.value === 'filtered') return props.filtered
  return props.all
})

const formats: { id: ExportFormat; name: string; desc: string }[] = [
  { id: 'markdown', name: t.exportDialog.fmtMarkdown, desc: t.exportDialog.fmtMarkdownDesc },
  { id: 'text', name: t.exportDialog.fmtText, desc: t.exportDialog.fmtTextDesc },
  { id: 'csv', name: t.exportDialog.fmtCsv, desc: t.exportDialog.fmtCsvDesc },
  { id: 'json', name: t.exportDialog.fmtJson, desc: t.exportDialog.fmtJsonDesc },
  { id: 'folder', name: t.exportDialog.fmtFolder, desc: t.exportDialog.fmtFolderDesc },
]

const selection = computed(() => ({ fields: chosenFields.value }))

/** 按当前选项生成导出内容（复制到剪贴板与导出共用） */
function buildResult(): { fileName: string; content: string } | null {
  switch (format.value) {
    case 'markdown':
      return exportMarkdown(props.library, props.template, entries.value, selection.value)
    case 'text':
      return exportPlainText(props.library, props.template, entries.value, selection.value, textStyle.value)
    case 'csv':
      return exportCsv(props.library, props.template, entries.value, selection.value)
    case 'json':
      return exportJson(props.library, props.template, entries.value, selection.value)
    default:
      return null
  }
}

const preview = computed<string>(() => {
  if (entries.value.length === 0) return ''
  const sample = entries.value.slice(0, 2)
  switch (format.value) {
    case 'markdown':
      return exportMarkdown(props.library, props.template, sample, selection.value).content
    case 'text':
      return exportPlainText(props.library, props.template, sample, selection.value, textStyle.value).content
    case 'csv':
      return exportCsv(props.library, props.template, sample, selection.value).content.replace(/^\uFEFF/, '')
    case 'json':
      return exportJson(props.library, props.template, sample, selection.value).content
    case 'folder': {
      const plan = exportFolderPlan(props.library, props.template, sample, selection.value)
      return Object.entries(plan.files)
        .map(([name, content]) => `/* ${name} */\n${content}`)
        .join('\n')
    }
  }
})

function toggleField(id: string) {
  const set = new Set(chosenFields.value)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  chosenFields.value = props.template.fields.filter((f) => set.has(f.id)).map((f) => f.id)
}

async function doExport() {
  if (entries.value.length === 0) return
  try {
    if (format.value === 'folder') {
      await exportAsFolder()
    } else {
      await exportAsFile()
    }
    // 文件成功落盘后才关闭导出窗口（复制到剪贴板不关闭）
    emit('close')
  } catch (err) {
    ui.toast(err instanceof Error ? err.message : '导出失败', 'danger')
  }
}

async function copyResult() {
  if (entries.value.length === 0) return
  if (format.value === 'folder') {
    const plan = exportFolderPlan(props.library, props.template, entries.value, selection.value)
    const text = Object.entries(plan.files)
      .map(([name, content]) => `/* ${name} */\n${content}`)
      .join('\n\n')
    const ok = await copyToClipboard(text)
    if (ok) ui.toast(t.exportDialog.copied)
    return
  }
  const result = buildResult()
  if (!result) return
  const ok = await copyToClipboard(result.content)
  if (ok) ui.toast(t.exportDialog.copied)
  else ui.toast('复制失败', 'danger')
}

async function exportAsFile() {
  const result = buildResult()
  if (!result) return
  if (isDesktop()) {
    const path = await pickSavePath(result.fileName)
    if (!path) return
    await writeTextAbsolute(path, result.content)
    exportedPath.value = path
    exportedIsDir.value = false
  } else {
    downloadText(result.fileName, result.content)
    exportedPath.value = result.fileName
    exportedIsDir.value = false
  }
  ui.toast(t.exportDialog.exportedTo(exportedPath.value))
  await settings.set({ defaultExportFormat: format.value })
}

async function exportAsFolder() {
  const plan = exportFolderPlan(props.library, props.template, entries.value, selection.value)
  if (isDesktop()) {
    const dir = await pickDirectory()
    if (!dir) return
    const target = `${dir}/${plan.dirName}`
    await mkdirAbsolute(target)
    for (const [name, content] of Object.entries(plan.files)) {
      await writeTextAbsolute(`${target}/${name}`, content)
    }
    await writeTextAbsolute(`${target}/index.json`, plan.indexJson)
    exportedPath.value = target
    exportedIsDir.value = true
  } else {
    for (const [name, content] of Object.entries(plan.files)) {
      downloadText(name, content)
      await new Promise((r) => setTimeout(r, 200))
    }
    exportedPath.value = plan.dirName
    exportedIsDir.value = true
  }
  ui.toast(t.exportDialog.exportedTo(exportedPath.value))
  await settings.set({ defaultExportFormat: format.value })
}

async function reveal() {
  if (exportedPath.value && isDesktop()) await revealInFinder(exportedPath.value, exportedIsDir.value)
}
</script>

<template>
  <AppModal wide @close="emit('close')">
    <header class="modal-head">
      <h2>{{ t.exportDialog.title }} · {{ props.library.name }}</h2>
      <button class="icon-btn" :aria-label="t.common.close" @click="emit('close')"><AppIcon name="x" /></button>
    </header>

    <div class="modal-body export-body">
      <section class="exp-section">
        <h3>{{ t.exportDialog.scope }}</h3>
        <div class="radio-row">
          <label class="radio"><input v-model="scope" type="radio" value="all" /> {{ t.exportDialog.scopeAll }}（{{ props.all.length }}）</label>
          <label class="radio"><input v-model="scope" type="radio" value="filtered" /> {{ t.exportDialog.scopeFiltered }}（{{ props.filtered.length }}）</label>
          <label class="radio" :class="{ disabled: props.selected.length === 0 }">
            <input v-model="scope" type="radio" value="selected" :disabled="props.selected.length === 0" />
            {{ t.exportDialog.scopeSelected(props.selected.length) }}
          </label>
        </div>
      </section>

      <section class="exp-section">
        <h3>{{ t.exportDialog.fields }}</h3>
        <div class="field-row-wrap">
          <label v-for="field in props.template.fields" :key="field.id" class="radio">
            <input type="checkbox" :checked="chosenFields.includes(field.id)" @change="toggleField(field.id)" />
            {{ field.name }}
          </label>
        </div>
      </section>

      <section class="exp-section">
        <h3>{{ t.exportDialog.format }}</h3>
        <div class="fmt-grid">
          <button
            v-for="fmt in formats"
            :key="fmt.id"
            class="fmt-card"
            :class="{ on: format === fmt.id }"
            type="button"
            @click="format = fmt.id"
          >
            <span class="fmt-name">{{ fmt.name }}</span>
            <span class="hint">{{ fmt.desc }}</span>
          </button>
        </div>

        <!-- 纯文本：选择制表符分隔或分节形式 -->
        <div v-if="format === 'text'" class="text-style">
          <label class="radio">
            <input v-model="textStyle" type="radio" value="tsv" />
            <span>
              <strong>{{ t.exportDialog.textTsv }}</strong>
              <span class="hint style-hint">{{ t.exportDialog.textTsvDesc }}</span>
            </span>
          </label>
          <label class="radio">
            <input v-model="textStyle" type="radio" value="sections" />
            <span>
              <strong>{{ t.exportDialog.textSections }}</strong>
              <span class="hint style-hint">{{ t.exportDialog.textSectionsDesc }}</span>
            </span>
          </label>
        </div>
      </section>

      <section v-if="preview" class="exp-section">
        <h3>{{ t.exportDialog.preview }}</h3>
        <pre class="preview">{{ preview }}</pre>
      </section>
    </div>

    <footer class="modal-foot export-foot">
      <span v-if="exportedPath" class="exported meta">
        {{ t.exportDialog.exportedTo(exportedPath) }}
        <button v-if="isDesktop()" class="btn btn-ghost btn-sm" @click="reveal">
          <AppIcon name="folder" :size="14" />
          {{ t.exportDialog.reveal }}
        </button>
      </span>
      <span class="meta">{{ entries.length }} {{ t.exportDialog.entriesUnit }}</span>
      <button class="btn" :disabled="entries.length === 0" @click="copyResult">
        <AppIcon name="copy" :size="15" />
        {{ t.exportDialog.copyClipboard }}
      </button>
      <button class="btn btn-primary" :disabled="entries.length === 0" @click="doExport">
        <AppIcon name="export" :size="15" />
        {{ t.exportDialog.doExport }}
      </button>
    </footer>
  </AppModal>
</template>

<style scoped>
.export-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.exp-section h3 {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
  margin-bottom: 8px;
  text-transform: none;
}

.radio-row,
.field-row-wrap {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
}

.radio {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.radio.disabled {
  opacity: 0.45;
  cursor: default;
}

.radio input {
  accent-color: var(--accent);
}

.text-style {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
  padding: 10px 12px;
  background: var(--surface-2);
  border-radius: var(--r-m);
}

.text-style .radio > span {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.style-hint {
  margin-left: 0;
}

.fmt-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
  gap: 8px;
}

.fmt-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 10px 12px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-m);
  background: var(--surface);
  text-align: left;
  transition: border-color 150ms ease, background 150ms ease, transform 100ms ease-out;
}

.fmt-card:hover {
  border-color: var(--hairline-strong);
}

.fmt-card:active {
  transform: scale(0.98);
}

.fmt-card.on {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.fmt-name {
  font-weight: 600;
  font-size: 13px;
}

.preview {
  margin: 0;
  padding: 12px;
  background: var(--surface-2);
  border-radius: var(--r-m);
  font-size: 12px;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  max-height: 180px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.export-foot {
  align-items: center;
}

.export-foot .exported {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-right: auto;
  max-width: 55%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btn-sm {
  height: 28px;
  font-size: 12px;
}
</style>
