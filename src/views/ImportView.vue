<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { TableLayout } from '../core/extract'
import type { FieldDef } from '../core/models'
import type { SourceKind } from '../core/parsers/types'
import { useImporterStore, type ImportFileRef, type ImportFileState } from '../stores/importer'
import { useLibrariesStore, type AppendPlan, type ConflictDecision } from '../stores/libraries'
import { useTemplatesStore } from '../stores/templates'
import { useUiStore } from '../stores/ui'
import { repo } from '../core/storage/repo'
import { imageBlobOf } from '../core/image'
import { t } from '../locales/strings'
import { isDesktop } from '../lib/platform'
import { extendFsScope } from '../lib/desktop'
import AppIcon from '../components/AppIcon.vue'
import AppModal from '../components/AppModal.vue'
import AppSelect from '../components/AppSelect.vue'
import ConfidenceBadge from '../components/ConfidenceBadge.vue'

const route = useRoute()
const router = useRouter()
const importer = useImporterStore()
const libraries = useLibrariesStore()
const templates = useTemplatesStore()
const ui = useUiStore()
ui.setPageTitle(t.import.title)

const dragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)
const activeFileId = ref('')
const busy = ref(false)
/** 源文件存档方式：copy 复制进库（默认）/ link 记录原位置（仅桌面端） */
const fileMode = ref<'copy' | 'link'>('copy')

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
      // 纯附件批次（无法提取文本）也允许进入入库步骤
      return importer.files.some((f) => f.doc) && (importer.allDrafts.length > 0 || importer.files.every((f) => f.doc!.kind === 'file'))
    case 5:
      if (importer.targetMode === 'new') {
        return (importer.newLibName.trim() !== '' || importer.files.length > 0) && newLocationReady.value
      }
      return importer.targetLibId !== ''
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

/** 单元格图片在未被导入的工作表里时给出提示，避免「导入完没图」的困惑 */
const strayImages = computed(() => {
  const f = activeFile.value
  if (!f?.doc || f.doc.kind !== 'xlsx' || f.images.length === 0) return null
  const strays = f.images.filter((img) => img.sheet !== f.tableLabel)
  if (strays.length === 0) return null
  const sheets = [...new Set(strays.map((i) => i.sheet))].join('、')
  return t.import.imagesInOtherSheet(strays.length, sheets)
})

/* ---------- 步骤 4 预览：单元格图片缩略图 ---------- */
const previewUrls = ref<Record<string, string>>({})
const previewImg = ref<string | null>(null)

watch(
  () => activeFile.value?.images.map((i) => i.name).join(','),
  async () => {
    const f = activeFile.value
    if (!f) return
    for (const img of f.images) {
      if (previewUrls.value[img.name]) continue
      const blob = imageBlobOf(img.name, img.bytes)
      if (blob) previewUrls.value = { ...previewUrls.value, [img.name]: URL.createObjectURL(blob) }
    }
  },
  { immediate: true },
)

/** 预览表里每条草稿（下标）对应的图片：字段级跟随映射列，其余归入条目级「图片」列 */
const draftImageMap = computed<Map<number, { fieldId?: string; name: string }[]>>(() => {
  const map = new Map<number, { fieldId?: string; name: string }[]>()
  const f = activeFile.value
  if (!f?.doc || f.doc.kind !== 'xlsx' || f.images.length === 0) return map
  const isCol = f.resolvedLayout === 'headerLeft'
  const fieldByCol = new Map<number, string>()
  if (!isCol) {
    for (const [fid, col] of Object.entries(f.mapping)) {
      if (col >= 0) fieldByCol.set(col, fid)
    }
  }
  for (const img of f.images) {
    if (img.sheet !== f.tableLabel) continue
    const di = f.drafts.findIndex((d) => (isCol ? d.sourceCol === img.col : d.sourceRow === img.row))
    if (di === -1) continue
    const item = { fieldId: isCol ? undefined : fieldByCol.get(img.col), name: img.name }
    const list = map.get(di) ?? []
    list.push(item)
    map.set(di, list)
  }
  return map
})

function imagesOfDraft(draftIndex: number, fieldId: string): { name: string; url: string }[] {
  return (draftImageMap.value.get(draftIndex) ?? [])
    .filter((img) => img.fieldId === fieldId)
    .map((img) => ({ name: img.name, url: previewUrls.value[img.name] }))
    .filter((img) => img.url !== undefined)
}

const entryLevelImages = computed(() => {
  const f = activeFile.value
  if (!f) return new Map<number, { name: string; url: string }[]>()
  const out = new Map<number, { name: string; url: string }[]>()
  for (const [di, list] of draftImageMap.value) {
    const urls = list
      .filter((img) => !img.fieldId)
      .map((img) => ({ name: img.name, url: previewUrls.value[img.name] }))
      .filter((img) => img.url !== undefined)
    if (urls.length > 0) out.set(di, urls)
  }
  return out
})

function kindLabel(kind: SourceKind): string {
  return kind === 'docx' ? t.import.kindDocx : kind === 'xlsx' ? t.import.kindXlsx : kind === 'text' ? t.import.kindText : t.import.kindFile
}

function kindIcon(kind: SourceKind): 'sheet' | 'doc' | 'text' {
  return kind === 'xlsx' ? 'sheet' : kind === 'text' ? 'text' : 'doc'
}

/** 把桌面端对话框返回的路径登记进 fs scope 再交给导入器 */
async function importPaths(paths: string[]) {
  for (const p of paths) await extendFsScope(p, false)
  await onFilesChosen(paths.map((p) => ({ name: p.split(/[\\/]/).pop() ?? p, path: p })))
}

function pickFiles() {
  if (isDesktop()) {
    void (async () => {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({ multiple: true, title: t.import.chooseFiles })
      if (!picked) return
      await importPaths(Array.isArray(picked) ? picked : [picked])
    })()
    return
  }
  fileInput.value?.click()
}

async function onFilesChosen(list: ImportFileRef[]) {
  if (list.length === 0) return
  await importer.addFiles(list)
  activeFileId.value = importer.files[0]?.id ?? ''
}

function onDrop(e: DragEvent) {
  dragging.value = false
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  void onFilesChosen(Array.from(files, (f) => ({ name: f.name, file: f })))
}

/* 桌面端的拖放由 Tauri 接管（WebView 的 HTML drop 不触发），走窗口拖放事件拿路径 */
let unlistenDrag: (() => void) | null = null
let dragHover = 0

onMounted(async () => {
  if (!isDesktop()) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    unlistenDrag = await getCurrentWindow().onDragDropEvent((ev) => {
      if (ev.payload.type === 'enter') {
        dragHover++
        dragging.value = true
      } else if (ev.payload.type === 'leave') {
        dragHover = Math.max(0, dragHover - 1)
        if (dragHover === 0) dragging.value = false
      } else if (ev.payload.type === 'drop') {
        dragHover = 0
        dragging.value = false
        if (ev.payload.paths.length > 0) void importPaths(ev.payload.paths)
      }
    })
  } catch {
    /* 拿不到窗口句柄时拖放不可用，按钮选择不受影响 */
  }
})
onBeforeUnmount(() => unlistenDrag?.())

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

/* ---------- 步骤 5：新库位置 + 追加冲突检测 ---------- */

/** 新建库的存放位置 radio 代理（'inner' / 'custom'） */
const newLocMode = ref<'inner' | 'custom'>('inner')
const newLocationReady = computed(() => newLocMode.value === 'inner' || importer.newLibDir !== '')

async function pickNewLibLocation() {
  const { pickDirectory } = await import('../lib/desktop')
  const dir = await pickDirectory()
  if (!dir) return
  if (!(await repo().canWriteAbs(dir))) {
    ui.toast(t.settings.locationNotWritable, 'danger')
    return
  }
  importer.newLibDir = dir
}

/** 每个文件的重复 / 冲突预检结果 */
interface FileAppendPlan {
  file: ImportFileState
  plan: AppendPlan
  remapped: Record<string, string | number>[]
  fields: FieldDef[]
}

const appendPlans = ref<Map<string, FileAppendPlan>>(new Map())
/** 冲突处理决定：fileId → (draft 下标 → 决定)，默认覆盖 */
const decisions = ref<Record<string, Record<number, ConflictDecision>>>({})
/** 正在编辑的冲突条目 */
const editing = ref<{ fileId: string; index: number } | null>(null)
const editValues = ref<Record<string, string>>({})

watch(
  () => [importer.targetMode, importer.targetLibId, importer.allDrafts.length, step.value] as const,
  () => rebuildPlans(),
  { immediate: true },
)

function rebuildPlans() {
  if (importer.targetMode !== 'append' || !importer.targetLibId || step.value < 5) {
    appendPlans.value = new Map()
    return
  }
  const map = new Map<string, FileAppendPlan>()
  const nextDecisions: Record<string, Record<number, ConflictDecision>> = {}
  const prev = decisions.value
  for (const f of importer.files) {
    if (!f.doc || f.drafts.length === 0) continue
    const { plan, remapped, fields } = libraries.planAppend(importer.targetLibId, f.drafts, f.inferred?.fields ?? [])
    if (plan.duplicates.length + plan.conflicts.length === 0) continue
    map.set(f.id, { file: f, plan, remapped, fields })
    const fileDecisions: Record<number, ConflictDecision> = {}
    for (const c of plan.conflicts) {
      fileDecisions[c.index] = prev[f.id]?.[c.index] ?? 'overwrite'
    }
    nextDecisions[f.id] = fileDecisions
  }
  decisions.value = nextDecisions
  appendPlans.value = map
}

const totalDuplicates = computed(() => [...appendPlans.value.values()].reduce((n, p) => n + p.plan.duplicates.length, 0))
const totalConflicts = computed(() => [...appendPlans.value.values()].reduce((n, p) => n + p.plan.conflicts.length, 0))
const hasCompare = computed(() => importer.targetMode === 'append' && importer.targetLibId !== '' && (totalDuplicates.value > 0 || totalConflicts.value > 0))

function entryTitleOf(plan: FileAppendPlan, values: Record<string, string | number>): string {
  const field = plan.fields.find((f) => f.kind === 'text' && /标题|主题|题目|书名|项目|name|title/i.test(f.name)) ?? plan.fields.find((f) => f.kind === 'text')
  const v = field ? values[field.id] : undefined
  const s = v === undefined ? '' : String(v).trim()
  return s === '' ? t.common.untitled : s.split(/\r?\n/)[0].slice(0, 40)
}

/** 冲突条目里值有差异的字段 */
function diffFields(plan: FileAppendPlan, index: number, existingValues: Record<string, string | number>): { field: FieldDef; from: string; to: string }[] {
  const incoming = plan.remapped[index]
  const out: { field: FieldDef; from: string; to: string }[] = []
  for (const field of plan.fields) {
    const a = existingValues[field.id]
    const b = incoming[field.id]
    const same = (a === undefined || String(a) === '') === (b === undefined || String(b) === '') &&
      (a === undefined || String(a) === '' || String(a) === String(b))
    if (!same) out.push({ field, from: a === undefined ? '' : String(a), to: b === undefined ? '' : String(b) })
  }
  return out
}

function openEdit(plan: FileAppendPlan, fileId: string, index: number) {
  editing.value = { fileId, index }
  const incoming = plan.remapped[index]
  const values: Record<string, string> = {}
  for (const field of plan.fields) {
    const v = incoming[field.id]
    values[field.id] = v === undefined ? '' : String(v)
  }
  editValues.value = values
}

/** 保存冲突编辑：把修改写回对应文件的草稿值，再重新比对 */
function saveEdit() {
  if (!editing.value) return
  const plan = appendPlans.value.get(editing.value.fileId)
  if (!plan) {
    editing.value = null
    return
  }
  const draft = plan.file.drafts[editing.value.index]
  const sourceFields = plan.file.inferred?.fields ?? []
  for (const sf of sourceFields) {
    // 该源字段按名字映射到的库字段，就是编辑面板里对应的输入框
    const target = plan.fields.find((f) => f.name.replace(/\s+/g, '').toLowerCase() === sf.name.replace(/\s+/g, '').toLowerCase())
    if (!target) continue
    const nextValue = editValues.value[target.id]
    if (nextValue !== undefined) draft.values[sf.id] = nextValue
  }
  editing.value = null
  rebuildPlans()
}

function setDecision(fileId: string, index: number, decision: ConflictDecision) {
  if (!decisions.value[fileId]) decisions.value[fileId] = {}
  decisions.value[fileId][index] = decision
}

function setAllDecisions(decision: ConflictDecision) {
  for (const [fileId, plan] of appendPlans.value) {
    if (!decisions.value[fileId]) decisions.value[fileId] = {}
    for (const c of plan.plan.conflicts) decisions.value[fileId][c.index] = decision
  }
}

async function finish() {
  busy.value = true
  try {
    const storageDir = importer.targetMode === 'new' && newLocMode.value === 'custom' ? importer.newLibDir : null
    const result = await importer.commit(decisions.value, storageDir, fileMode.value)
    if (result) {
      if (importer.targetMode === 'append' && (result.overwritten > 0 || result.skipped > 0)) {
        ui.toast(t.import.importedDetail(result.added, result.overwritten, result.skipped, libraries.byId(result.libraryId)?.name ?? ''))
      } else {
        ui.toast(t.import.imported(result.count, libraries.byId(result.libraryId)?.name ?? ''))
      }
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
      <ol class="steps">
        <li v-for="(label, i) in t.import.steps" :key="label">
          <!-- 已走过的步骤可点回；当前步与未解锁步不可点 -->
          <button
            class="step-btn"
            :class="{ on: step === i + 1, done: step > i + 1 }"
            type="button"
            :disabled="step <= i + 1"
            :aria-current="step === i + 1 ? 'step' : undefined"
            @click="importer.step = i + 1"
          >
            <span class="dot">{{ step > i + 1 ? '✓' : i + 1 }}</span>
            {{ label }}
          </button>
        </li>
      </ol>
    </header>

    <!-- 步骤内容切换：快速非线性过渡 -->
    <Transition name="step" mode="out-in">
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
        <input ref="fileInput" type="file" multiple hidden @change="onFilesChosen(Array.from(($event.target as HTMLInputElement)?.files ?? []).map((f) => ({ name: f.name, file: f })))" />
      </div>

      <div v-if="importer.files.length > 0" class="file-block">
        <div class="file-head">
          <h2 class="file-title">{{ t.import.fileListTitle }}</h2>
          <span class="meta">{{ t.import.fileCount(importer.files.length) }}</span>
        </div>
        <ul class="file-list">
          <li v-for="f in importer.files" :key="f.id" class="card file-item">
            <AppIcon class="file-icon" :name="f.doc ? kindIcon(f.doc.kind) : 'doc'" :size="17" />
            <div class="file-info">
              <span class="file-name">{{ f.name }}</span>
              <span v-if="f.error" class="meta error">{{ f.error }}</span>
              <span v-else-if="f.doc?.kind === 'file'" class="meta">{{ t.import.kindFile }} · {{ t.import.fileAttachNote }}</span>
              <span v-else-if="f.doc" class="meta">{{ kindLabel(f.doc.kind) }} · {{ f.doc.blocks.length }} 个内容块</span>
              <span v-else class="meta">解析中…</span>
            </div>
            <button class="icon-btn danger file-remove" :aria-label="t.import.removeFile" @click="importer.removeFile(f.id)">
              <AppIcon name="x" />
            </button>
          </li>
        </ul>
      </div>
    </section>

    <!-- 步骤 2：识别结果 -->
    <section v-else-if="step === 2" class="step-body">
      <div v-for="f in importer.files" :key="f.id" class="card rec-card">
        <div class="rec-head">
          <AppIcon :name="f.doc ? kindIcon(f.doc.kind) : 'doc'" :size="18" />
          <strong>{{ f.name }}</strong>
          <span v-if="f.doc" class="chip">{{ kindLabel(f.doc.kind) }}</span>
        </div>
        <p v-if="f.error" class="meta error">{{ f.error }}</p>
        <p v-else-if="f.doc?.kind === 'file'" class="meta">{{ t.import.fileAttachNote }}</p>
        <p v-else-if="f.doc" class="meta">
          识别出 {{ f.doc.blocks.length }} 个内容块
          · 标题 {{ f.doc.blocks.filter((b) => b.type === 'heading').length }}
          · 表格 {{ f.doc.blocks.filter((b) => b.type === 'table').length }}
          · 段落 {{ f.doc.blocks.filter((b) => b.type !== 'table').length }}
        </p>
        <p v-if="f.tables.length > 1" class="meta sheet-line">
          {{ t.import.sheets(f.tables.length) }}：{{ f.tables.map((tb, i) => `${tb.label || `表格${i + 1}`}（${tb.rows.length} 行）`).join('、') }}
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
          {{ f.name }}
        </button>
      </div>

      <template v-if="activeFile">
        <div class="card mode-card">
          <p class="mode-line">
            <AppIcon :name="activeFile.doc?.kind === 'file' ? 'doc' : activeFile.mode === 'table' ? 'table' : 'doc'" :size="15" />
            <strong>{{ activeFile.name }}</strong>
            <template v-if="activeFile.doc?.kind === 'file'">{{ t.import.fileAttachNote }}</template>
            <template v-else>
              {{ activeFile.mode === 'table' ? t.import.tableMode : activeFile.drafts.length > 1 ? t.import.logMode : t.import.documentMode }}
            </template>
          </p>

          <div v-if="activeFile.mode === 'table'" class="tuning">
            <label v-if="activeFile.tables.length > 1" class="tune-row">
              <span>{{ t.import.sheet }}</span>
              <AppSelect
                :model-value="activeFile.activeTable"
                :options="activeFile.tables.map((tb, ti) => ({ value: ti, label: `${tb.label || `表格${ti + 1}`}（${tb.rows.length} 行）` }))"
                @update:model-value="importer.setActiveSheet(activeFile.id, Number($event))"
              />
            </label>
            <label class="tune-row">
              <span>{{ t.import.layout }}</span>
              <AppSelect
                :model-value="activeFile.layout"
                :options="[
                  { value: 'auto', label: t.import.layoutAuto },
                  { value: 'headerTop', label: t.import.layoutTop },
                  { value: 'headerLeft', label: t.import.layoutLeft },
                ]"
                @update:model-value="importer.setLayout(activeFile.id, $event as TableLayout)"
              />
              <span v-if="activeFile.resolvedLayout === 'headerLeft'" class="chip">{{ t.import.layoutResolvedLeft }}</span>
              <span v-else-if="activeFile.resolvedLayout === 'headerTop'" class="chip">{{ t.import.layoutResolvedTop }}</span>
            </label>
          </div>

          <div v-if="activeFile.mode === 'table' && activeFile.tableHeader" class="mapping">
            <div v-for="field in activeFile.inferred?.fields ?? []" :key="field.id" class="map-row">
              <span class="map-field">{{ field.name }}</span>
              <AppIcon name="chevron-right" :size="13" class="map-arrow" />
              <AppSelect
                v-model="activeFile.mapping[field.id]"
                compact
                :options="[{ value: -1, label: '（不导入）' }, ...activeFile.tableHeader.map((col, ci) => ({ value: ci, label: col || `列${ci + 1}` }))]"
              />
            </div>
          </div>
          <p v-else-if="activeFile.doc?.kind !== 'file'" class="hint">{{ t.import.editCellHint }}</p>
        </div>

        <p v-if="strayImages" class="meta stray-note">
          <AppIcon name="info" :size="14" />
          {{ strayImages }}
        </p>

        <div v-if="activeFile.doc?.kind !== 'file'" class="extract-bar">
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
                <th v-if="entryLevelImages.size > 0" class="img-col">图片</th>
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
                  <div v-if="imagesOfDraft(di, field.id).length > 0" class="cell-thumbs">
                    <button
                      v-for="img in imagesOfDraft(di, field.id)"
                      :key="img.name"
                      type="button"
                      class="cell-thumb"
                      @click="previewImg = img.url"
                    >
                      <img :src="img.url" alt="" loading="lazy" />
                    </button>
                  </div>
                </td>
                <td v-if="entryLevelImages.size > 0" class="img-col">
                  <div v-if="entryLevelImages.get(di)?.length" class="cell-thumbs">
                    <button
                      v-for="img in entryLevelImages.get(di)"
                      :key="img.name"
                      type="button"
                      class="cell-thumb"
                      @click="previewImg = img.url"
                    >
                      <img :src="img.url" alt="" loading="lazy" />
                    </button>
                  </div>
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
          <AppSelect
            v-if="importer.targetMode === 'append'"
            v-model="importer.targetLibId"
            grow
            :options="libraries.libraries.map((l) => ({ value: l.id, label: `${l.name}（${l.entries.length} 条）` }))"
          />
        </label>

        <!-- 源文件存档方式：默认复制一份进库文件夹，桌面端可选只记录原位置 -->
        <div class="loc-block">
          <span class="loc-label">{{ t.import.fileModeLabel }}</span>
          <label class="loc-row">
            <input v-model="fileMode" type="radio" value="copy" />
            <span class="loc-name">{{ t.import.fileModeCopy }}</span>
          </label>
          <label v-if="isDesktop()" class="loc-row">
            <input v-model="fileMode" type="radio" value="link" />
            <span class="loc-name">{{ t.import.fileModeLink }}</span>
          </label>
        </div>

        <!-- 新建库：存放位置（桌面端） -->
        <div v-if="importer.targetMode === 'new' && isDesktop()" class="loc-block">
          <span class="loc-label">{{ t.import.newLibLocation }}</span>
          <label class="loc-row">
            <input v-model="newLocMode" type="radio" value="inner" />
            <span class="loc-name">{{ t.import.locationInner }}</span>
          </label>
          <label class="loc-row">
            <input v-model="newLocMode" type="radio" value="custom" />
            <span class="loc-name">{{ importer.newLibDir || t.import.locationCustom }}</span>
          </label>
          <button v-if="newLocMode === 'custom'" class="btn btn-sm" @click="pickNewLibLocation">
            <AppIcon name="folder" :size="14" />
            {{ t.oobe.pickFolder }}
          </button>
        </div>
      </div>

      <!-- 追加时的重复 / 冲突比对 -->
      <div v-if="hasCompare" class="card compare-card">
        <header class="compare-head">
          <AppIcon name="warning" :size="16" class="compare-icon" />
          <strong>{{ t.import.dupTitle }}</strong>
        </header>
        <p class="hint">{{ t.import.dupSummary(totalDuplicates, totalConflicts) }}</p>

        <div v-for="[fileId, p] in appendPlans" :key="fileId" class="compare-file">
          <p class="meta compare-file-name">{{ p.file.name }}</p>

          <div v-for="c in p.plan.conflicts" :key="c.index" class="conflict-row">
            <div class="conflict-main">
              <span class="conflict-title">{{ entryTitleOf(p, p.remapped[c.index]) }}</span>
              <div class="seg seg-sm">
                <button :class="{ on: decisions[fileId]?.[c.index] === 'overwrite' }" @click="setDecision(fileId, c.index, 'overwrite')">
                  {{ t.import.conflictOverwrite }}
                </button>
                <button :class="{ on: decisions[fileId]?.[c.index] === 'skip' }" @click="setDecision(fileId, c.index, 'skip')">
                  {{ t.import.conflictSkip }}
                </button>
              </div>
              <button class="btn btn-ghost btn-sm" @click="openEdit(p, fileId, c.index)">
                <AppIcon name="pencil" :size="13" />
                {{ t.import.conflictEdit }}
              </button>
            </div>
            <ul class="diff-list">
              <li v-for="d in diffFields(p, c.index, c.existing.values)" :key="d.field.id">
                <span class="diff-name">{{ d.field.name }}</span>
                <span class="diff-old">{{ d.from || '—' }}</span>
                <AppIcon name="chevron-right" :size="12" class="diff-arrow" />
                <span class="diff-new">{{ d.to || '—' }}</span>
              </li>
            </ul>
          </div>
        </div>

        <footer v-if="totalConflicts > 0" class="compare-foot">
          <button class="btn btn-ghost btn-sm" @click="setAllDecisions('overwrite')">{{ t.import.conflictOverwriteAll }}</button>
          <button class="btn btn-ghost btn-sm" @click="setAllDecisions('skip')">{{ t.import.conflictSkipAll }}</button>
        </footer>
      </div>
      <p v-else-if="importer.targetMode === 'append' && importer.targetLibId" class="hint compare-clear">
        {{ t.import.noConflict }}
      </p>
    </section>
    </Transition>

    <footer class="wizard-foot">
      <div class="foot-pill">
        <button v-if="step > 1" class="btn" @click="prev">{{ t.common.back }}</button>
        <button v-if="step < 5" class="btn btn-primary" :disabled="!canNext" @click="next">{{ t.common.next }}</button>
        <button v-else class="btn btn-primary" :disabled="!canNext || busy" @click="finish">
          <AppIcon name="check" :size="15" />
          {{ t.import.finish }}
        </button>
      </div>
    </footer>

    <!-- 预览图片放大 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="previewImg" class="img-lightbox" role="button" @click="previewImg = null">
          <img :src="previewImg" alt="" />
        </div>
      </Transition>
    </Teleport>

    <!-- 冲突条目编辑 -->
    <AppModal :open="!!editing" @close="editing = null">
      <header class="modal-head">
        <h2>{{ t.import.conflictEditTitle }}</h2>
        <button class="icon-btn" :aria-label="t.common.close" @click="editing = null"><AppIcon name="x" /></button>
      </header>
      <div v-if="editing" class="modal-body">
        <p class="hint">{{ t.import.conflictEditDesc }}</p>
        <div v-for="field in appendPlans.get(editing.fileId)?.fields ?? []" :key="field.id" class="form-row edit-row">
          <label>{{ field.name }}</label>
          <input v-model="editValues[field.id]" class="input" type="text" />
          <p class="hint">{{ t.import.conflictKeepExisting }}：
            {{ (appendPlans.get(editing.fileId)?.plan.conflicts.find((c) => c.index === editing!.index)?.existing.values[field.id] ?? '') || '—' }}
          </p>
        </div>
      </div>
      <footer class="modal-foot">
        <button class="btn" @click="editing = null">{{ t.common.cancel }}</button>
        <button class="btn btn-primary" @click="saveEdit">{{ t.common.save }}</button>
      </footer>
    </AppModal>
  </div>
</template>

<style scoped>
.page {
  padding: 28px 32px 20px;
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.page-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

/* 步骤指示：跟随在「导入」标题后，靠右对齐 */
.steps {
  display: flex;
  gap: 4px;
  list-style: none;
  margin: 0 0 0 auto;
  padding: 0;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.steps li {
  display: flex;
}

/* 步骤按钮：走过的步骤可点回，hover 反馈落在按下前 */
.step-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 1.2rem;
  color: var(--ink-3);
  padding: 4px 10px 4px 4px;
  border-radius: 999px;
  transition: background 150ms ease, color 150ms ease, transform 100ms ease-out;
}

.step-btn:not(:disabled):hover {
  background: var(--surface-2);
  color: var(--ink);
}

.step-btn:not(:disabled):active {
  transform: scale(0.96);
}

.step-btn:disabled {
  cursor: default;
}

.step-btn .dot {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--surface-2);
  font-size: 1.1rem;
  font-variant-numeric: tabular-nums;
}

.step-btn.on {
  color: var(--accent);
  font-weight: 600;
}

.step-btn.on .dot {
  background: var(--accent);
  color: var(--accent-ink);
}

.step-btn.done {
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
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--ink);
}

.file-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.file-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 0 2px;
}

.file-title {
  font-size: 1.3rem;
  font-weight: 600;
  color: var(--ink-2);
}

.file-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
}

.file-icon {
  flex: none;
  color: var(--ink-2);
}

.file-remove {
  flex: none;
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
  display: flex;
  flex-direction: column;
  gap: 8px;
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

.tuning {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--hairline);
}

.tune-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.tune-row > span:first-child {
  flex: none;
  font-weight: 500;
}

.tune-row .select {
  width: auto;
  min-width: 180px;
}

.sheet-line {
  margin-top: 2px;
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

.stray-note {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-radius: var(--r-s);
  background: var(--warn-bg);
  color: var(--warn);
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
  font-size: 1.25rem;
  min-width: 90px;
}

.drafts-more {
  padding: 8px 12px;
}

/* 预览表里的单元格图片缩略图 */
.img-col {
  width: 72px;
}

.cell-thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.cell-thumb {
  display: inline-flex;
  width: 44px;
  height: 34px;
  padding: 0;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid var(--hairline);
  background: var(--surface-2);
}

.cell-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
  transition: transform 150ms var(--ease-sheet);
}

.cell-thumb:hover img {
  transform: scale(1.08);
}

.img-lightbox {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: var(--scrim);
  display: grid;
  place-items: center;
  padding: 32px;
  cursor: zoom-out;
}

.img-lightbox img {
  max-width: min(920px, 92vw);
  max-height: 88vh;
  border-radius: var(--r-m);
  box-shadow: var(--shadow-2);
  background: #fff;
}

.target-card {
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
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

/* 新库位置 */
.loc-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--hairline);
}

.loc-label {
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--ink-2);
}

.loc-row {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 6px 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-s);
}

.loc-row:has(input:checked) {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.loc-name {
  font-weight: 500;
  font-size: 1.25rem;
  word-break: break-all;
}

/* 冲突比对 */
.compare-card {
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.compare-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.compare-icon {
  color: var(--warn);
}

.compare-file {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.compare-file-name {
  font-weight: 600;
  color: var(--ink-2);
}

.conflict-row {
  border: 1px solid var(--hairline);
  border-radius: var(--r-s);
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.conflict-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.conflict-title {
  flex: 1;
  min-width: 0;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seg-sm button {
  height: 24px;
  padding: 0 10px;
  font-size: 1.2rem;
}

.diff-list {
  list-style: none;
  margin: 0;
  padding: 0 0 0 12px;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.diff-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.2rem;
  min-width: 0;
}

.diff-name {
  flex: none;
  width: 84px;
  color: var(--ink-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-old {
  color: var(--ink-3);
  text-decoration: line-through;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;
}

.diff-arrow {
  color: var(--ink-3);
  flex: none;
}

.diff-new {
  color: var(--ink-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 220px;
}

.compare-foot {
  display: flex;
  gap: 8px;
}

.compare-clear {
  padding: 4px 2px;
}

.edit-row {
  margin-bottom: 12px;
}

/* 底部导航：固定悬浮于页面底部居中，药丸材质 */
.wizard-foot {
  position: sticky;
  bottom: 0;
  z-index: 6;
  display: flex;
  justify-content: center;
  margin-top: auto;
  padding: 14px 0 6px;
  pointer-events: none;
}

.foot-pill {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--surface) 72%, transparent);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid var(--hairline);
  box-shadow: var(--shadow-1);
}

/* 底部导航按钮用最大圆角，与外层药丸呼应 */
.foot-pill .btn {
  border-radius: 999px;
  padding: 0 18px;
}

@media (prefers-reduced-transparency: reduce) {
  .foot-pill {
    background: var(--surface);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

@media (max-width: 860px) {
  .page {
    padding: 20px 16px 32px;
  }

  /* 头部换行：返回 + 标题一行，步骤指示整行落到下方，不再挤压标题 */
  .page-head {
    flex-wrap: wrap;
  }

  .steps {
    flex-basis: 100%;
    justify-content: flex-start;
    margin-left: 0;
  }

  .dropzone {
    padding: 32px 16px;
  }

  /* 工作表/布局调节行：窄屏下拉独占剩余宽度 */
  .tune-row {
    flex-wrap: wrap;
  }

  .tune-row .select {
    flex: 1 1 160px;
    min-width: 0;
  }

  /* 字段映射行：字段名与下拉允许换行，下拉占满一行 */
  .map-row {
    flex-wrap: wrap;
  }

  .map-row .select {
    flex: 1 1 160px;
  }

  /* 冲突行：标题独占一行，覆盖/跳过与编辑按钮换到下一行 */
  .conflict-main {
    flex-wrap: wrap;
  }

  .seg-sm {
    margin-right: auto;
  }

  /* 差异对比与预览单元格在窄屏收窄，避免横向溢出 */
  .diff-old,
  .diff-new {
    max-width: 34vw;
  }

  .cell-truncate {
    max-width: 180px;
  }
}
</style>
