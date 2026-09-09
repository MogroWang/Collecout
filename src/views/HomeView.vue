<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useLibrariesStore } from '../stores/libraries'
import { useTemplatesStore } from '../stores/templates'
import { useUiStore } from '../stores/ui'
import { t } from '../locales/strings'
import AppIcon from '../components/AppIcon.vue'
import AppModal from '../components/AppModal.vue'
import EmptyState from '../components/EmptyState.vue'

const router = useRouter()
const libraries = useLibrariesStore()
const templates = useTemplatesStore()
const ui = useUiStore()

const showNew = ref(false)
const newName = ref('')
const newTemplateId = ref(templates.all[0]?.id ?? 'tpl_auto')

const sorted = computed(() => libraries.libraries)

function openLibrary(id: string) {
  router.push(`/library/${id}`)
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10)
}

async function createLibrary() {
  const lib = await libraries.create(newName.value || t.common.untitled, newTemplateId.value)
  ui.toast(t.toast.libraryCreated(lib.name))
  showNew.value = false
  newName.value = ''
  router.push(`/library/${lib.id}`)
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
        <button class="btn btn-primary" @click="showNew = true">
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
    >
      <button class="btn btn-primary" @click="router.push('/import')">
        <AppIcon name="import" :size="15" />
        {{ t.home.import }}
      </button>
      <button class="btn" @click="showNew = true">{{ t.home.emptyNew }}</button>
    </EmptyState>

    <div v-else class="lib-grid">
      <article
        v-for="lib in sorted"
        :key="lib.id"
        class="card clickable lib-card"
        @click="openLibrary(lib.id)"
      >
        <h2 class="lib-name">{{ lib.name }}</h2>
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
          <select v-model="newTemplateId" class="select">
            <option v-for="tpl in templates.all" :key="tpl.id" :value="tpl.id">{{ tpl.name }}</option>
          </select>
          <p class="hint">{{ templates.byId(newTemplateId)?.description }}</p>
        </div>
      </div>
      <footer class="modal-foot">
        <button class="btn" @click="showNew = false">{{ t.common.cancel }}</button>
        <button class="btn btn-primary" @click="createLibrary">{{ t.home.create }}</button>
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
}

@media (max-width: 860px) {
  .page {
    padding: 20px 16px 32px;
  }
}
</style>
