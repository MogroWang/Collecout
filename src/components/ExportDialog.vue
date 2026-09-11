<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Entry, ExportFormat, Library, Template } from '../core/models'
import {
  exportCsv,
  exportJson,
  exportMarkdown,
  exportPlainText,
  exportDocxBytes,
  exportXlsxBytes,
  exportFolderPlan,
  renderPages,
  canvasToJpeg,
  canvasToPng,
  buildPdf,
  type TextExportStyle,
  type FolderImageLayout,
} from '../core/export'
import { useSettingsStore } from '../stores/settings'
import { useLibrariesStore } from '../stores/libraries'
import { useUiStore } from '../stores/ui'
import { t } from '../locales/strings'
import { sanitizeFileName } from '../core/export'
import { isDesktop } from '../lib/platform'
import { copyToClipboard, downloadBlob, downloadText, mkdirAbsolute, pickDirectory, pickSavePath, revealInFinder, writeBinaryAbsolute, writeTextAbsolute } from '../lib/desktop'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  library: Library
  template: Template
  all: Entry[]
  filtered: Entry[]
  selected: Entry[]
  /** 弹窗显隐：组件常驻，由 Transition 驱动进出动画 */
  open: boolean
}>()

const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()
const libraries = useLibrariesStore()
const ui = useUiStore()

const scope = ref<'all' | 'filtered' | 'selected'>('all')
const chosenFields = ref<string[]>(props.template.fields.map((f) => f.id))
const format = ref<ExportFormat>(settings.settings.defaultExportFormat)
const textStyle = ref<TextExportStyle>('tsv')
/** 本地文件夹导出的文本格式 */
const folderExt = ref<'md' | 'txt'>('md')
/** 本地文件夹导出的图片组织方式 */
const folderLayout = ref<FolderImageLayout>('row')
const exportedPath = ref<string | null>(null)
const exportedIsDir = ref(false)

const BINARY_FORMATS: ExportFormat[] = ['docx', 'xlsx', 'pdf', 'image']
const isBinaryFormat = computed(() => BINARY_FORMATS.includes(format.value))

const entries = computed<Entry[]>(() => {
  if (scope.value === 'selected') return props.selected
  if (scope.value === 'filtered') return props.filtered
  return props.all
})

const formats: { id: ExportFormat; name: string; desc: string }[] = [
  { id: 'markdown', name: t.exportDialog.fmtMarkdown, desc: t.exportDialog.fmtMarkdownDesc },
  { id: 'text', name: t.exportDialog.fmtText, desc: t.exportDialog.fmtTextDesc },
  { id: 'docx', name: t.exportDialog.fmtDocx, desc: t.exportDialog.fmtDocxDesc },
  { id: 'xlsx', name: t.exportDialog.fmtXlsx, desc: t.exportDialog.fmtXlsxDesc },
  { id: 'pdf', name: t.exportDialog.fmtPdf, desc: t.exportDialog.fmtPdfDesc },
  { id: 'image', name: t.exportDialog.fmtImage, desc: t.exportDialog.fmtImageDesc },
  { id: 'csv', name: t.exportDialog.fmtCsv, desc: t.exportDialog.fmtCsvDesc },
  { id: 'json', name: t.exportDialog.fmtJson, desc: t.exportDialog.fmtJsonDesc },
  { id: 'folder', name: t.exportDialog.fmtFolder, desc: t.exportDialog.fmtFolderDesc },
]

const selection = computed(() => ({ fields: chosenFields.value }))

/* ---------- 条目图片字节：所有格式的图片随文导出共用 ---------- */
const imageBytes = ref<Map<string, Uint8Array>>(new Map())
/** storedAs → 导入时的原始文件名（文件夹导出按原名落盘） */
const imageNames = ref<Map<string, string>>(new Map())

const imageSignature = computed(() =>
  entries.value.flatMap((e) => (e.images ?? []).map((i) => i.storedAs)).filter((v, i, a) => a.indexOf(v) === i).join(','),
)

watch(imageSignature, async () => {
  const bytes = new Map<string, Uint8Array>()
  for (const storedAs of imageSignature.value.split(',')) {
    if (!storedAs) continue
    const blob = await libraries.readImage(props.library.id, storedAs)
    if (!blob) continue
    bytes.set(storedAs, new Uint8Array(await blob.arrayBuffer()))
  }
  imageBytes.value = bytes
}, { immediate: true })

watch(() => props.library.sources, (sources) => {
  const names = new Map<string, string>()
  for (const s of sources) for (const f of s.files ?? []) if (f.kind === 'image') names.set(f.storedAs, f.name)
  imageNames.value = names
}, { immediate: true, deep: true })

/** 纯文本单文件导出时，图片写到文件旁的 images/ 目录 */
async function writeImagesBeside(filePath: string): Promise<boolean> {
  if (imageBytes.value.size === 0) return false
  const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '.'
  await mkdirAbsolute(`${dir}/images`)
  for (const [storedAs, bytes] of imageBytes.value) {
    await writeBinaryAbsolute(`${dir}/images/${storedAs}`, bytes)
  }
  return true
}

/** 按当前选项生成导出内容（复制到剪贴板与文本导出共用） */
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

const preview = computed<string | null>(() => {
  if (entries.value.length === 0 || isBinaryFormat.value) return null
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
      const plan = exportFolderPlan(props.library, props.template, sample, selection.value, folderExt.value, folderLayout.value, { bytes: imageBytes.value, nameOf: imageNames.value })
      return Object.entries(plan.files)
        .map(([name, content]) => `/* ${name} */\n${content}`)
        .join('\n')
    }
    default:
      return null
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
    if (format.value === 'folder') await exportAsFolder()
    else if (format.value === 'docx') await exportAsDocx()
    else if (format.value === 'xlsx') await exportAsXlsx()
    else if (format.value === 'pdf' || format.value === 'image') await exportAsPaged()
    else await exportAsFile()
    // 文件成功落盘后才关闭导出窗口
    emit('close')
  } catch (err) {
    ui.toast(err instanceof Error ? err.message : '导出失败', 'danger')
  }
}

async function copyResult() {
  if (entries.value.length === 0 || isBinaryFormat.value) return
  if (format.value === 'folder') {
    const plan = exportFolderPlan(props.library, props.template, entries.value, selection.value, folderExt.value, folderLayout.value, { bytes: imageBytes.value, nameOf: imageNames.value })
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
    // 纯文本格式：单元格图片以原文件形式写到 images/ 目录，路径已写在文本里
    await writeImagesBeside(path)
    exportedPath.value = path
    exportedIsDir.value = false
  } else {
    downloadText(result.fileName, result.content)
    for (const [storedAs, bytes] of imageBytes.value) {
      downloadBlob(`images/${storedAs}`, new Blob([bytes.slice().buffer as ArrayBuffer]))
      await new Promise((r) => setTimeout(r, 200))
    }
    exportedPath.value = result.fileName
    exportedIsDir.value = false
  }
  ui.toast(t.exportDialog.exportedTo(exportedPath.value))
  await settings.set({ defaultExportFormat: format.value })
}

/** Word 文档：单文件二进制导出（图片行内嵌入） */
async function exportAsDocx() {
  const bytes = exportDocxBytes(props.library, props.template, entries.value, selection.value, imageBytes.value)
  const fileName = sanitizeFileName(`${props.library.name} 导出 ${new Date().toISOString().slice(0, 10)}`) + '.docx'
  const blob = new Blob([bytes.slice().buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  if (isDesktop()) {
    const path = await pickSavePath(fileName)
    if (!path) return
    await writeBinaryAbsolute(path, bytes)
    exportedPath.value = path
    exportedIsDir.value = false
  } else {
    downloadBlob(fileName, blob)
    exportedPath.value = fileName
    exportedIsDir.value = false
  }
  ui.toast(t.exportDialog.exportedTo(exportedPath.value))
  await settings.set({ defaultExportFormat: format.value })
}

/** Excel 表格：单文件二进制导出（图片嵌入单元格） */
async function exportAsXlsx() {
  const bytes = exportXlsxBytes(props.library, props.template, entries.value, selection.value, imageBytes.value)
  const fileName = sanitizeFileName(`${props.library.name} 导出 ${new Date().toISOString().slice(0, 10)}`) + '.xlsx'
  const blob = new Blob([bytes.slice().buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  if (isDesktop()) {
    const path = await pickSavePath(fileName)
    if (!path) return
    await writeBinaryAbsolute(path, bytes)
    exportedPath.value = path
    exportedIsDir.value = false
  } else {
    downloadBlob(fileName, blob)
    exportedPath.value = fileName
    exportedIsDir.value = false
  }
  ui.toast(t.exportDialog.exportedTo(exportedPath.value))
  await settings.set({ defaultExportFormat: format.value })
}

/** PDF（单文件）/ 图片（每页一张 PNG） */
async function exportAsPaged() {
  const pages = await renderPages(props.library, props.template, entries.value, selection.value, imageBytes.value)
  const base = sanitizeFileName(`${props.library.name} 导出 ${new Date().toISOString().slice(0, 10)}`)
  if (format.value === 'pdf') {
    const bytes = buildPdf(pages.map((c) => ({ jpeg: canvasToJpeg(c), pixelW: c.width, pixelH: c.height })))
    const fileName = `${base}.pdf`
    if (isDesktop()) {
      const path = await pickSavePath(fileName)
      if (!path) return
      await writeBinaryAbsolute(path, bytes)
      exportedPath.value = path
      exportedIsDir.value = false
    } else {
      downloadBlob(fileName, new Blob([bytes.slice().buffer], { type: 'application/pdf' }))
      exportedPath.value = fileName
      exportedIsDir.value = false
    }
  } else {
    if (isDesktop()) {
      const dir = await pickDirectory()
      if (!dir) return
      const target = `${dir}/${base}`
      await mkdirAbsolute(target)
      for (const [i, canvas] of pages.entries()) {
        await writeBinaryAbsolute(`${target}/${base}_${String(i + 1).padStart(3, '0')}.png`, canvasToPng(canvas))
      }
      exportedPath.value = target
      exportedIsDir.value = true
    } else {
      for (const [i, canvas] of pages.entries()) {
        const bytes = canvasToPng(canvas)
        downloadBlob(`${base}_${String(i + 1).padStart(3, '0')}.png`, new Blob([bytes.slice().buffer], { type: 'image/png' }))
        await new Promise((r) => setTimeout(r, 200))
      }
      exportedPath.value = base
      exportedIsDir.value = true
    }
  }
  ui.toast(t.exportDialog.exportedTo(exportedPath.value))
  await settings.set({ defaultExportFormat: format.value })
}

async function exportAsFolder() {
  const plan = exportFolderPlan(props.library, props.template, entries.value, selection.value, folderExt.value, folderLayout.value, { bytes: imageBytes.value, nameOf: imageNames.value })
  if (isDesktop()) {
    const dir = await pickDirectory()
    if (!dir) return
    const target = `${dir}/${plan.dirName}`
    await mkdirAbsolute(target)
    for (const [name, content] of Object.entries(plan.files)) {
      await writeTextAbsolute(`${target}/${name}`, content)
    }
    // 图片原文件（可能带子文件夹）逐个落盘
    for (const [rel, bytes] of Object.entries(plan.binaries)) {
      const full = `${target}/${rel}`
      const sub = full.slice(0, full.lastIndexOf('/'))
      if (sub) await mkdirAbsolute(sub)
      await writeBinaryAbsolute(full, bytes)
    }
    await writeTextAbsolute(`${target}/index.json`, plan.indexJson)
    exportedPath.value = target
    exportedIsDir.value = true
  } else {
    for (const [name, content] of Object.entries(plan.files)) {
      downloadText(name, content)
      await new Promise((r) => setTimeout(r, 200))
    }
    for (const [rel, bytes] of Object.entries(plan.binaries)) {
      downloadBlob(rel.split('/').pop() ?? rel, new Blob([bytes.slice().buffer as ArrayBuffer]))
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
  <AppModal wide :open="props.open" @close="emit('close')">
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

        <!-- 本地文件夹：选择条目文件的格式与图片的组织方式 -->
        <div v-if="format === 'folder'" class="text-style">
          <span class="folder-ext-label">{{ t.exportDialog.folderExt }}</span>
          <div class="radio-row">
            <label class="radio">
              <input v-model="folderExt" type="radio" value="md" />
              {{ t.exportDialog.folderExtMd }}
            </label>
            <label class="radio">
              <input v-model="folderExt" type="radio" value="txt" />
              {{ t.exportDialog.folderExtTxt }}
            </label>
          </div>
          <span class="folder-ext-label">{{ t.exportDialog.folderImageLayout }}</span>
          <div class="radio-row">
            <label class="radio">
              <input v-model="folderLayout" type="radio" value="row" />
              {{ t.exportDialog.folderImageRow }}
            </label>
            <label class="radio">
              <input v-model="folderLayout" type="radio" value="column" />
              {{ t.exportDialog.folderImageColumn }}
            </label>
          </div>
        </div>
      </section>

      <!-- 预览区：内容生成后淡入，格式切换时平滑替换 -->
      <Transition name="fade" mode="out-in">
        <section v-if="preview !== null" key="preview" class="exp-section">
          <h3>{{ t.exportDialog.preview }}</h3>
          <pre class="preview">{{ preview }}</pre>
        </section>
        <section v-else-if="isBinaryFormat" key="binary" class="exp-section">
          <p class="hint">{{ t.exportDialog.noTextPreview }}</p>
        </section>
      </Transition>
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
      <button class="btn" :disabled="entries.length === 0 || isBinaryFormat" @click="copyResult">
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

.folder-ext-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--ink-2);
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
