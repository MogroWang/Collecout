<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Entry, Template } from '../core/models'
import { applyFilters, EMPTY_FILTER, sortEntries, type FilterState, type SortDir } from '../core/query/filter'
import { isExternalLibrary } from '../core/storage/repo'
import { useLibrariesStore } from '../stores/libraries'
import { useTemplatesStore } from '../stores/templates'
import { useUiStore } from '../stores/ui'
import { t } from '../locales/strings'
import { isDesktop } from '../lib/platform'
import AppIcon from '../components/AppIcon.vue'
import AppModal from '../components/AppModal.vue'
import DataTable from '../components/DataTable.vue'
import CardGrid from '../components/CardGrid.vue'
import FilterPopover from '../components/FilterPopover.vue'
import SortMenu from '../components/SortMenu.vue'
import ExportDialog from '../components/ExportDialog.vue'
import EntryDrawer from '../components/EntryDrawer.vue'
import EmptyState from '../components/EmptyState.vue'

const props = defineProps<{ id: string }>()

const router = useRouter()
const libraries = useLibrariesStore()
const templates = useTemplatesStore()
const ui = useUiStore()

const view = ref<'table' | 'cards'>('table')
const filter = ref<FilterState>({ ...EMPTY_FILTER })
const sort = ref<{ fieldId: string; dir: SortDir } | null>(null)
const selected = ref(new Set<string>())
const openEntryId = ref<string | null>(null)
const showExport = ref(false)
const showRename = ref(false)
const showDelete = ref(false)
const showLocation = ref(false)
const renamingLocation = ref(false)
const renameText = ref('')
const showFilterPanel = ref(false)
const showSortPanel = ref(false)

const library = computed(() => libraries.byId(props.id))
const templateName = computed(() => templates.byId(library.value?.templateId ?? '')?.name ?? '')
/** 字段用库自带的快照（与条目值的键一致），模板仅提供名字展示 */
const template = computed<Template>(() => ({
  id: library.value?.templateId ?? '',
  name: templateName.value || library.value?.name || '',
  description: '',
  builtin: false,
  fields: library.value?.fields ?? [],
}))
const fields = computed(() => template.value.fields)

watch(
  () => props.id,
  () => {
    filter.value = { ...EMPTY_FILTER }
    sort.value = null
    selected.value = new Set()
    openEntryId.value = null
  },
)

const filteredEntries = computed(() => {
  if (!library.value) return []
  return applyFilters(library.value.entries, fields.value, filter.value)
})

const visibleEntries = computed(() => {
  if (!sort.value) return filteredEntries.value
  return sortEntries(filteredEntries.value, fields.value, sort.value.fieldId, sort.value.dir)
})

const selectedEntries = computed(() => library.value?.entries.filter((e) => selected.value.has(e.id)) ?? [])
const openEntry = computed(() => library.value?.entries.find((e) => e.id === openEntryId.value) ?? null)
const isFiltering = computed(() => filter.value.search.trim() !== '' || filter.value.rules.length > 0)

/* ---------- 多选：shift / ctrl 范围与切换 ---------- */
let anchorIndex = -1

function selectWithModifiers(id: string, index: number, mod: { shift: boolean; meta: boolean }) {
  const next = new Set(selected.value)
  if (mod.shift && anchorIndex >= 0) {
    const [a, b] = anchorIndex <= index ? [anchorIndex, index] : [index, anchorIndex]
    for (let i = a; i <= b; i++) {
      const entry = visibleEntries.value[i]
      if (entry) next.add(entry.id)
    }
  } else if (next.has(id)) {
    next.delete(id)
    anchorIndex = index
  } else {
    next.add(id)
    anchorIndex = index
  }
  selected.value = next
}

function toggleAll() {
  if (selected.value.size === visibleEntries.value.length) {
    selected.value = new Set()
  } else {
    selected.value = new Set(visibleEntries.value.map((e) => e.id))
    anchorIndex = -1
  }
}

function clearSelection() {
  selected.value = new Set()
  anchorIndex = -1
}

/* ---------- 框选（勾选至少一项后，在列表区拖出选框批量圈选） ---------- */
const entriesWrap = ref<HTMLElement | null>(null)
const marquee = ref<{ x1: number; y1: number; x2: number; y2: number } | null>(null)
const marqueeHits = ref<Set<string>>(new Set())
let marqueeBase: Set<string> | null = null
let marqueePending = false
let marqueeActive = false
let marqueeStart = { x: 0, y: 0 }
/** 框选结束后吞掉紧随而来的 click，避免误触「打开条目」 */
let suppressClick = false

const multiSelectMode = computed(() => selected.value.size > 0)
/** 框选过程中预览的选中集合实时替代正式集合，保证表格 / 卡片高亮一致 */
const effectiveSelected = computed(() => (marquee.value ? marqueeHits.value : selected.value))

function marqueeRect() {
  const m = marquee.value!
  return {
    left: Math.min(m.x1, m.x2),
    right: Math.max(m.x1, m.x2),
    top: Math.min(m.y1, m.y2),
    bottom: Math.max(m.y1, m.y2),
  }
}

function onMarqueeStart(e: MouseEvent) {
  if (e.button !== 0 || !multiSelectMode.value) return
  const target = e.target as HTMLElement
  if (target.closest('input, button, a, select, textarea, label')) return
  e.preventDefault()
  // 普通拖拽 = 以框选结果为准；按住 Ctrl/Cmd 拖拽 = 在已有选择上追加
  marqueeBase = e.ctrlKey || e.metaKey ? new Set(selected.value) : new Set()
  marqueePending = true
  marqueeActive = false
  marqueeStart = { x: e.clientX, y: e.clientY }
  window.addEventListener('mousemove', onMarqueeMove)
  window.addEventListener('mouseup', onMarqueeEnd)
}

function onMarqueeMove(e: MouseEvent) {
  if (!marqueePending) return
  // 拖动超过阈值才算框选；微小位移视为普通点击，不干扰「点击行打开条目」
  if (!marqueeActive && Math.hypot(e.clientX - marqueeStart.x, e.clientY - marqueeStart.y) < 4) return
  if (!marqueeActive) {
    marqueeActive = true
    suppressClick = true
    marquee.value = { x1: marqueeStart.x, y1: marqueeStart.y, x2: e.clientX, y2: e.clientY }
  } else {
    marquee.value = { ...marquee.value!, x2: e.clientX, y2: e.clientY }
  }
  const rect = marqueeRect()
  const hits = new Set(marqueeBase)
  for (const el of entriesWrap.value?.querySelectorAll<HTMLElement>('[data-entry-id]') ?? []) {
    const r = el.getBoundingClientRect()
    const hit = !(r.right < rect.left || r.left > rect.right || r.bottom < rect.top || r.top > rect.bottom)
    const id = el.dataset.entryId ?? ''
    if (hit) hits.add(id)
    else if (!marqueeBase?.has(id)) hits.delete(id)
  }
  marqueeHits.value = hits
}

function onMarqueeEnd() {
  window.removeEventListener('mousemove', onMarqueeMove)
  window.removeEventListener('mouseup', onMarqueeEnd)
  marqueePending = false
  if (marqueeActive && marquee.value) selected.value = new Set(marqueeHits.value)
  marqueeActive = false
  marquee.value = null
  marqueeBase = null
  marqueeHits.value = new Set()
}

/** 框选拖拽后的那次 click 不是用户点击，直接拦下 */
function onCaptureClick(e: MouseEvent) {
  if (suppressClick) {
    e.stopPropagation()
    e.preventDefault()
    suppressClick = false
  }
}

/* ---------- 键盘：Ctrl/Cmd+A 全选，Esc 取消 ---------- */
function onKeydown(e: KeyboardEvent) {
  if (openEntryId.value || showExport.value || showRename.value || showDelete.value || showLocation.value) return
  const inField = (e.target as HTMLElement).closest?.('input, textarea, select')
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !inField) {
    e.preventDefault()
    if (visibleEntries.value.length > 0) {
      selected.value = new Set(visibleEntries.value.map((x) => x.id))
    }
  } else if (e.key === 'Escape' && !inField && selected.value.size > 0) {
    clearSelection()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('mousemove', onMarqueeMove)
  window.removeEventListener('mouseup', onMarqueeEnd)
})

/* ---------- 排序 ---------- */
function onSort(fieldId: string) {
  if (!sort.value || sort.value.fieldId !== fieldId) {
    sort.value = { fieldId, dir: 'asc' }
  } else if (sort.value.dir === 'asc') {
    sort.value = { fieldId, dir: 'desc' }
  } else {
    sort.value = null
  }
}

/* ---------- 条目操作 ---------- */
function saveEntry(entry: Entry) {
  if (!library.value) return
  libraries.updateEntry(library.value.id, entry)
  ui.toast(t.library.saved)
  openEntryId.value = null
}

function deleteEntry(id: string) {
  if (!library.value) return
  libraries.removeEntries(library.value.id, [id])
  selected.value.delete(id)
  openEntryId.value = null
  ui.toast(t.library.deleted(1))
}

/* ---------- 库管理 ---------- */
function rename() {
  if (!library.value) return
  libraries.rename(library.value.id, renameText.value)
  showRename.value = false
}

async function removeLibrary() {
  if (!library.value) return
  await libraries.remove(library.value.id)
  ui.toast(t.toast.libraryDeleted)
  showDelete.value = false
  router.push('/')
}

/** 库文件独立存放的路径展示 */
const locationText = computed(() => {
  const lib = library.value
  if (!lib) return ''
  return isExternalLibrary(lib) ? `${lib.storagePath}/${lib.fileName}` : t.library.locationInner
})

async function moveLibraryTo(dir: string | null) {
  if (!library.value) return
  renamingLocation.value = true
  try {
    const moved = await libraries.moveLibrary(library.value.id, dir)
    if (moved) {
      ui.toast(dir ? t.library.locationChanged(`${moved.storagePath}/${moved.fileName}`) : t.library.locationMovedInner)
    }
    showLocation.value = false
  } catch (err) {
    ui.toast(err instanceof Error ? err.message : '移动失败', 'danger')
  } finally {
    renamingLocation.value = false
  }
}

async function pickNewLocation() {
  const { pickDirectory } = await import('../lib/desktop')
  const dir = await pickDirectory()
  if (!dir) return
  await moveLibraryTo(dir)
}
</script>

<template>
  <div v-if="library" class="page">
    <header class="page-head">
      <div class="head-text">
        <h1 class="large-title">{{ library.name }}</h1>
        <p class="meta">
          {{ template.name }} · {{ library.entries.length }} {{ t.home.entries }}
          <template v-if="library.sources.length > 0"> · {{ library.sources.length }} 个来源文件</template>
        </p>
        <p class="meta loc-line">
          <AppIcon name="folder" :size="13" />
          <span class="loc-text">{{ locationText }}</span>
          <button v-if="isDesktop()" class="btn btn-ghost btn-compact" @click="showLocation = true">
            {{ t.library.changeLocation }}
          </button>
        </p>
      </div>
      <div class="head-actions">
        <button class="icon-btn" :aria-label="t.common.rename" @click="renameText = library.name; showRename = true">
          <AppIcon name="pencil" />
        </button>
        <button class="icon-btn danger" :aria-label="t.common.delete" @click="showDelete = true">
          <AppIcon name="trash" />
        </button>
        <button class="btn" @click="router.push(`/import?lib=${library.id}`)">
          <AppIcon name="import" :size="15" />
          {{ t.library.importHere }}
        </button>
        <button class="btn btn-primary" @click="showExport = true">
          <AppIcon name="export" :size="15" />
          {{ t.library.export }}
        </button>
      </div>
    </header>

    <EmptyState
      v-if="library.entries.length === 0"
      icon="doc"
      :title="t.library.emptyTitle"
      :desc="t.library.emptyDesc"
    >
      <button class="btn btn-primary" @click="router.push(`/import?lib=${library.id}`)">
        <AppIcon name="import" :size="15" />
        {{ t.library.importHere }}
      </button>
    </EmptyState>

    <template v-else>
      <div class="toolbar">
        <div class="seg">
          <button :class="{ on: view === 'table' }" @click="view = 'table'">{{ t.library.table }}</button>
          <button :class="{ on: view === 'cards' }" @click="view = 'cards'">{{ t.library.cards }}</button>
        </div>

        <div class="search-wrap">
          <AppIcon name="search" :size="14" class="search-icon" />
          <input v-model="filter.search" class="input search-input" type="search" :placeholder="t.common.search" />
        </div>

        <div class="filter-anchor">
          <button class="btn" :class="{ 'filter-on': isFiltering }" @click="showFilterPanel = !showFilterPanel">
            <AppIcon name="filter" :size="15" />
            {{ t.library.filter }}
            <span v-if="filter.rules.length > 0" class="chip">{{ filter.rules.length }}</span>
          </button>
          <Transition name="pop">
            <div v-if="showFilterPanel" class="filter-pop card">
              <FilterPopover
                :fields="fields"
                :state="filter"
                @update:state="(s) => { filter = s; showFilterPanel = false }"
              />
            </div>
          </Transition>
        </div>

        <div class="filter-anchor">
          <button class="btn" :class="{ 'filter-on': sort !== null }" @click="showSortPanel = !showSortPanel">
            <AppIcon name="sort" :size="15" />
            <template v-if="sort">
              {{ fields.find((f) => f.id === sort!.fieldId)?.name ?? t.library.sort }}
              {{ sort.dir === 'asc' ? '↑' : '↓' }}
            </template>
            <template v-else>{{ t.library.sort }}</template>
          </button>
          <Transition name="pop">
            <div v-if="showSortPanel" class="filter-pop card">
              <SortMenu :fields="fields" :sort="sort" @update:sort="(s) => { sort = s; showSortPanel = false }" />
            </div>
          </Transition>
        </div>

        <span class="count meta">{{ t.library.entryCount(visibleEntries.length, library.entries.length) }}</span>
        <template v-if="selected.size > 0">
          <span class="chip">{{ t.library.selected(selected.size) }}</span>
          <button class="btn btn-ghost btn-compact" :title="t.library.selectAllHint" @click="clearSelection">
            {{ t.library.clearSelection }}
          </button>
        </template>

        <button v-if="isFiltering" class="btn btn-ghost btn-compact" @click="filter = { ...EMPTY_FILTER }; sort = null">
          {{ t.library.clearFilter }}
        </button>
      </div>

      <EmptyState v-if="visibleEntries.length === 0" icon="filter" :title="t.library.noMatch">
        <button class="btn" @click="filter = { ...EMPTY_FILTER }">{{ t.library.clearFilter }}</button>
      </EmptyState>

      <!-- 勾选至少一项后，可在列表区域拖动框选批量选择 -->
      <div v-else ref="entriesWrap" class="entries-wrap" @mousedown="onMarqueeStart" @click.capture="onCaptureClick">
        <DataTable
          v-if="view === 'table'"
          :fields="fields"
          :entries="visibleEntries"
          :selected="effectiveSelected"
          :sort="sort"
          @select="selectWithModifiers"
          @toggle-all="toggleAll"
          @sort="onSort"
          @open="(id) => (openEntryId = id)"
        />
        <CardGrid
          v-else
          :fields="fields"
          :entries="visibleEntries"
          :selected="effectiveSelected"
          @select="selectWithModifiers"
          @open="(id) => (openEntryId = id)"
        />
      </div>
    </template>

    <EntryDrawer
      v-if="openEntry"
      :library="library"
      :template="template"
      :entry="openEntry"
      @close="openEntryId = null"
      @save="saveEntry"
      @delete="deleteEntry"
    />

    <ExportDialog
      v-if="showExport"
      :library="library"
      :template="template"
      :all="library.entries"
      :filtered="filteredEntries"
      :selected="selectedEntries"
      @close="showExport = false"
    />

    <!-- 框选矩形 -->
    <div
      v-if="marquee"
      class="marquee"
      :style="{
        left: marqueeRect().left + 'px',
        top: marqueeRect().top + 'px',
        width: marqueeRect().right - marqueeRect().left + 'px',
        height: marqueeRect().bottom - marqueeRect().top + 'px',
      }"
    />

    <AppModal v-if="showRename" @close="showRename = false">
      <header class="modal-head">
        <h2>{{ t.library.renameTitle }}</h2>
        <button class="icon-btn" @click="showRename = false"><AppIcon name="x" /></button>
      </header>
      <div class="modal-body">
        <input v-model="renameText" class="input" type="text" @keydown.enter="rename" />
      </div>
      <footer class="modal-foot">
        <button class="btn" @click="showRename = false">{{ t.common.cancel }}</button>
        <button class="btn btn-primary" @click="rename">{{ t.common.save }}</button>
      </footer>
    </AppModal>

    <AppModal v-if="showDelete" @close="showDelete = false">
      <header class="modal-head">
        <h2>{{ t.library.deleteTitle }}</h2>
        <button class="icon-btn" @click="showDelete = false"><AppIcon name="x" /></button>
      </header>
      <div class="modal-body">
        <p>{{ t.library.deleteDesc(library.name, library.entries.length) }}</p>
      </div>
      <footer class="modal-foot">
        <button class="btn" @click="showDelete = false">{{ t.common.cancel }}</button>
        <button class="btn btn-danger" @click="removeLibrary">
          <AppIcon name="trash" :size="15" />
          {{ t.common.delete }}
        </button>
      </footer>
    </AppModal>

    <!-- 更改库的存放位置 -->
    <AppModal v-if="showLocation" @close="showLocation = false">
      <header class="modal-head">
        <h2>{{ t.library.location }}</h2>
        <button class="icon-btn" @click="showLocation = false"><AppIcon name="x" /></button>
      </header>
      <div class="modal-body">
        <p class="loc-current meta">{{ locationText }}</p>
      </div>
      <footer class="modal-foot">
        <button
          v-if="isExternalLibrary(library)"
          class="btn"
          :disabled="renamingLocation"
          @click="moveLibraryTo(null)"
        >
          {{ t.library.locationInner }}
        </button>
        <span class="foot-spacer"></span>
        <button class="btn" :disabled="renamingLocation" @click="showLocation = false">{{ t.common.cancel }}</button>
        <button v-if="isDesktop()" class="btn btn-primary" :disabled="renamingLocation" @click="pickNewLocation">
          <AppIcon name="folder" :size="15" />
          {{ t.library.changeLocation }}
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
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 14px;
}

.head-text .meta {
  margin-top: 4px;
}

.loc-line {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--ink-3);
}

.loc-text {
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.head-actions {
  display: flex;
  gap: 8px;
  align-items: center;
  flex: none;
}

/* 工具栏：内容滚动时浮在其上，半透明材质 */
.toolbar {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 0;
  margin-bottom: 8px;
  background: color-mix(in srgb, var(--bg) 72%, transparent);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
}

@media (prefers-reduced-transparency: reduce) {
  .toolbar {
    background: var(--bg);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

.search-wrap {
  position: relative;
  flex: 0 1 240px;
}

.search-icon {
  position: absolute;
  left: 9px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--ink-3);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding-left: 28px;
}

.filter-anchor {
  position: relative;
}

.filter-on {
  border-color: var(--accent);
  color: var(--accent);
}

.filter-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  width: 320px;
  box-shadow: var(--shadow-1);
  transform-origin: top left;
  z-index: 20;
}

.count {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.btn-compact {
  height: 28px;
  font-size: 12px;
}

/* 框选矩形 */
.marquee {
  position: fixed;
  z-index: 30;
  border: 1px solid var(--accent);
  background: var(--accent-soft);
  border-radius: 3px;
  pointer-events: none;
}

.loc-current {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11.5px;
  word-break: break-all;
}

.foot-spacer {
  flex: 1;
}

@media (max-width: 860px) {
  .page {
    padding: 20px 16px 32px;
  }

  .page-head {
    flex-direction: column;
  }

  .toolbar {
    flex-wrap: wrap;
  }
}
</style>
