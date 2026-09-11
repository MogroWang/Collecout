<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useLibrariesStore } from '../stores/libraries'
import { useTemplatesStore } from '../stores/templates'
import { useUiStore } from '../stores/ui'
import { repo } from '../core/storage/repo'
import { t } from '../locales/strings'
import { isDesktop } from '../lib/platform'
import AppIcon from '../components/AppIcon.vue'
import AppModal from '../components/AppModal.vue'
import AppSelect from '../components/AppSelect.vue'
import EmptyState from '../components/EmptyState.vue'

const router = useRouter()
const libraries = useLibrariesStore()
const templates = useTemplatesStore()
const ui = useUiStore()
ui.setPageTitle(t.home.title)

const showNew = ref(false)
const newName = ref('')
const newTemplateId = ref(templates.all[0]?.id ?? 'tpl_auto')
/** 新库存放位置：null = 软件数据文件夹；字符串 = 独立目录（桌面端） */
const newLocation = ref<string | null>(null)
const creating = ref(false)

/** radio 使用的 'inner' / 'custom' 代理值 */
const newLocationNullProxy = computed({
  get: () => (newLocation.value === null ? 'inner' : 'custom'),
  set: (v: string) => {
    if (v === 'inner') newLocation.value = null
    else if (newLocation.value === null) newLocation.value = ''
  },
})

const canCreate = computed(() => !creating.value && (newLocationNullProxy.value === 'inner' || newLocation.value !== ''))

const sorted = computed(() => libraries.libraries)

function openLibrary(id: string) {
  router.push(`/library/${id}`)
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10)
}

function openNewDialog() {
  newName.value = ''
  newLocation.value = null
  showNew.value = true
}

async function pickLocation() {
  const { pickDirectory } = await import('../lib/desktop')
  const dir = await pickDirectory()
  if (!dir) return
  if (!(await repo().canWriteAbs(dir))) {
    ui.toast(t.settings.locationNotWritable, 'danger')
    return
  }
  newLocation.value = dir
}

async function createLibrary() {
  creating.value = true
  try {
    const fields = templates.byId(newTemplateId.value)?.fields.map((f) => ({ ...f })) ?? []
    const lib = await libraries.create(newName.value || t.common.untitled, newTemplateId.value, fields, newLocation.value)
    ui.toast(t.toast.libraryCreated(lib.name))
    showNew.value = false
    router.push(`/library/${lib.id}`)
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <h1 class="large-title">{{ t.home.title }}</h1>
      <div class="head-actions">
        <button class="btn" @click="router.push('/import')">
          <AppIcon name="import" :size="15" />
          {{ t.home.import }}
        </button>
        <button class="btn btn-primary" @click="openNewDialog">
          <AppIcon name="plus" :size="15" />
          {{ t.nav.newLibrary }}
        </button>
      </div>
    </header>

    <EmptyState
      v-if="sorted.length === 0"
      icon="library"
      :title="t.home.emptyTitle"
      :desc="t.home.emptyDesc"
    />

    <div v-else class="lib-grid">
      <article
        v-for="lib in sorted"
        :key="lib.id"
        class="card clickable lib-card"
        @click="openLibrary(lib.id)"
      >
        <h2 class="lib-name">
          {{ lib.name }}
          <AppIcon v-if="lib.storagePath" name="folder" :size="13" class="ext-mark" />
        </h2>
        <p class="meta">
          {{ templates.byId(lib.templateId)?.name ?? t.common.untitled }}
          · {{ lib.entries.length }} {{ t.home.entries }}
        </p>
        <p class="hint">{{ t.home.updated }} {{ fmtDate(lib.updatedAt) }}</p>
      </article>
    </div>

    <AppModal v-if="showNew" @close="showNew = false">
      <header class="modal-head">
        <h2>{{ t.home.newLibTitle }}</h2>
        <button class="icon-btn" :aria-label="t.common.close" @click="showNew = false"><AppIcon name="x" /></button>
      </header>
      <div class="modal-body">
        <div class="form-row">
          <label>{{ t.home.newLibName }}</label>
          <input v-model="newName" class="input" type="text" :placeholder="t.home.newLibName" @keydown.enter="createLibrary" />
        </div>
        <div class="form-row">
          <label>{{ t.home.newLibTemplate }}</label>
          <AppSelect
            v-model="newTemplateId"
            grow
            :options="templates.all.map((tpl) => ({ value: tpl.id, label: tpl.name }))"
          />
          <p class="hint">{{ templates.byId(newTemplateId)?.description }}</p>
        </div>
        <div v-if="isDesktop()" class="form-row">
          <label>{{ t.home.newLibLocation }}</label>
          <label class="loc-row">
            <input v-model="newLocationNullProxy" type="radio" value="inner" />
            <span>
              <span class="loc-name">{{ t.home.locationInner }}</span>
              <span class="hint loc-desc">{{ t.home.locationInnerDesc }}</span>
            </span>
          </label>
          <label class="loc-row">
            <input v-model="newLocationNullProxy" type="radio" value="custom" />
            <span>
              <span class="loc-name">{{ newLocation ?? t.home.locationCustom }}</span>
              <span class="hint loc-desc">{{ t.home.locationCustomDesc }}</span>
            </span>
          </label>
          <button
            v-if="newLocationNullProxy === 'custom'"
            class="btn btn-sm"
            :disabled="creating"
            @click="pickLocation"
          >
            <AppIcon name="folder" :size="14" />
            {{ t.oobe.pickFolder }}
          </button>
        </div>
      </div>
      <footer class="modal-foot">
        <button class="btn" @click="showNew = false">{{ t.common.cancel }}</button>
        <button class="btn btn-primary" :disabled="!canCreate" @click="createLibrary">{{ t.home.create }}</button>
      </footer>
    </AppModal>
  </div>
</template>

<style scoped>
.page {
  padding: 28px 32px 48px;
  max-width: 1080px;
}

.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.head-actions {
  display: flex;
  gap: 8px;
}

.lib-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.lib-card {
  padding: 16px 18px;
}

.lib-name {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.ext-mark {
  color: var(--ink-3);
  flex: none;
}

.loc-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--hairline);
  border-radius: var(--r-s);
  cursor: pointer;
}

.loc-row:has(input:checked) {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.loc-row input {
  margin-top: 3px;
}

.loc-row > span {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.loc-name {
  font-weight: 500;
  word-break: break-all;
}

.loc-desc {
  margin-top: 2px;
}

.btn-sm {
  height: 28px;
  font-size: 12px;
  align-self: flex-start;
}

@media (max-width: 860px) {
  .page {
    padding: 20px 16px 32px;
  }
}
</style>
