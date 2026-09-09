<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Entry } from '../core/models'
import { applyFilters, EMPTY_FILTER, sortEntries, type FilterState, type SortDir } from '../core/query/filter'
import { useLibrariesStore } from '../stores/libraries'
import { useTemplatesStore } from '../stores/templates'
import { useUiStore } from '../stores/ui'
import { t } from '../locales/strings'
import AppIcon from '../components/AppIcon.vue'
import AppModal from '../components/AppModal.vue'
import DataTable from '../components/DataTable.vue'
import CardGrid from '../components/CardGrid.vue'
import FilterPopover from '../components/FilterPopover.vue'
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
const renameText = ref('')
const showFilterPanel = ref(false)

const library = computed(() => libraries.byId(props.id))
const template = computed(() => templates.byId(library.value?.templateId ?? '') ?? templates.byId('tpl_auto')!)
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

function onSort(fieldId: string) {
  if (!sort.value || sort.value.fieldId !== fieldId) {
    sort.value = { fieldId, dir: 'asc' }
  } else if (sort.value.dir === 'asc') {
    sort.value = { fieldId, dir: 'desc' }
  } else {
    sort.value = null
  }
}

function toggleSelect(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function toggleAll() {
  if (selected.value.size === visibleEntries.value.length) {
    selected.value = new Set()
  } else {
    selected.value = new Set(visibleEntries.value.map((e) => e.id))
  }
}

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

        <span class="count meta">{{ t.library.entryCount(visibleEntries.length, library.entries.length) }}</span>
        <span v-if="selected.size > 0" class="chip">{{ t.library.selected(selected.size) }}</span>

        <button v-if="isFiltering" class="btn btn-ghost btn-compact" @click="filter = { ...EMPTY_FILTER }; sort = null">
          {{ t.library.clearFilter }}
        </button>
      </div>

      <EmptyState v-if="visibleEntries.length === 0" icon="filter" :title="t.library.noMatch">
        <button class="btn" @click="filter = { ...EMPTY_FILTER }">{{ t.library.clearFilter }}</button>
      </EmptyState>

      <DataTable
        v-else-if="view === 'table'"
        :fields="fields"
        :entries="visibleEntries"
        :selected="selected"
        :sort="sort"
        @toggle-select="toggleSelect"
        @toggle-all="toggleAll"
        @sort="onSort"
        @open="(id) => (openEntryId = id)"
      />
      <CardGrid
        v-else
        :fields="fields"
        :entries="visibleEntries"
        @open="(id) => (openEntryId = id)"
      />
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
