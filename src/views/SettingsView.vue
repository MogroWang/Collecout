<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useLibrariesStore } from '../stores/libraries'
import { useTemplatesStore } from '../stores/templates'
import { repo } from '../core/storage/repo'
import { t } from '../locales/strings'
import { isDesktop, platform } from '../lib/platform'
import AppIcon from '../components/AppIcon.vue'
import AppModal from '../components/AppModal.vue'
import AppSelect from '../components/AppSelect.vue'

const settings = useSettingsStore()
const libraries = useLibrariesStore()
const templates = useTemplatesStore()

const dataPath = ref('')
const defaultPath = ref('')
const showChange = ref(false)
const changing = ref(false)
const changeError = ref('')

if (isDesktop()) {
  void repo().adapter.describeRoot?.().then((p) => (dataPath.value = p))
  void repo().describeDefaultRoot().then((p) => (defaultPath.value = p))
}

const isCustomRoot = computed(() => isDesktop() && defaultPath.value !== '' && dataPath.value !== defaultPath.value)

const themeOptions = [
  { id: 'system', label: t.settings.themeSystem },
  { id: 'light', label: t.settings.themeLight },
  { id: 'dark', label: t.settings.themeDark },
] as const

const formatOptions = [
  { id: 'markdown', label: 'Markdown' },
  { id: 'text', label: t.exportDialog.fmtText },
  { id: 'csv', label: 'CSV' },
  { id: 'json', label: 'JSON' },
] as const

async function setTheme(id: 'system' | 'light' | 'dark') {
  await settings.set({ theme: id })
}

async function openDataFolder() {
  const { revealInFinder } = await import('../lib/desktop')
  await revealInFinder(dataPath.value, true)
}

function beginChange() {
  changeError.value = ''
  showChange.value = true
}

async function pickNewRoot() {
  const { pickDirectory } = await import('../lib/desktop')
  changeError.value = ''
  const dir = await pickDirectory()
  if (!dir) return
  if (dir === dataPath.value) {
    showChange.value = false
    return
  }
  if (!(await repo().canWriteAbs(dir))) {
    changeError.value = t.settings.locationNotWritable
    return
  }
  await applyNewRoot(dir)
}

async function applyNewRoot(dir: string | null) {
  changing.value = true
  try {
    if (dir === null) {
      // 恢复默认：先把数据复制回默认文件夹，再清掉自定义指针
      await repo().copyDataTo(defaultPath.value)
      await repo().setDataRoot(null)
    } else {
      await repo().copyDataTo(dir)
    }
    await Promise.all([settings.load(), libraries.load(), templates.load()])
    dataPath.value = await (repo().adapter.describeRoot?.() ?? Promise.resolve(''))
    showChange.value = false
  } catch (err) {
    changeError.value = err instanceof Error ? err.message : t.settings.locationNotWritable
  } finally {
    changing.value = false
  }
}
</script>

<template>
  <div class="page">
    <h1 class="large-title">{{ t.settings.title }}</h1>

    <section class="group">
      <h2 class="group-title">{{ t.settings.appearance }}</h2>
      <div class="row">
        <span>{{ t.settings.theme }}</span>
        <div class="seg">
          <button
            v-for="opt in themeOptions"
            :key="opt.id"
            :class="{ on: settings.settings.theme === opt.id }"
            @click="setTheme(opt.id)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </section>

    <section class="group">
      <h2 class="group-title">{{ t.settings.exportDefaults }}</h2>
      <div class="row">
        <span>{{ t.settings.defaultFormat }}</span>
        <AppSelect
          :model-value="settings.settings.defaultExportFormat"
          :options="formatOptions.map((o) => ({ value: o.id, label: o.label }))"
          @update:model-value="settings.set({ defaultExportFormat: $event as never })"
        />
      </div>
    </section>

    <section class="group">
      <h2 class="group-title">{{ t.settings.data }}</h2>
      <div class="row">
        <span>{{ t.settings.dataLocation }}</span>
        <span class="path meta">
          {{ isDesktop() ? dataPath : platform() === 'capacitor' ? t.settings.dataAppNote : t.settings.dataLocalNote }}
        </span>
        <button v-if="isDesktop() && dataPath" class="btn btn-sm" @click="openDataFolder">
          <AppIcon name="folder" :size="14" />
          {{ t.settings.openDataFolder }}
        </button>
        <button v-if="isDesktop() && dataPath" class="btn btn-sm" @click="beginChange">
          <AppIcon name="pencil" :size="14" />
          {{ t.settings.changeLocation }}
        </button>
      </div>
      <p v-if="isDesktop()" class="hint row-note">{{ t.settings.dataRootNote }}</p>
      <p v-else class="hint row-note">库与模板以 JSON 文件保存在这里，可以直接备份或同步。</p>
    </section>

    <section class="group">
      <h2 class="group-title">{{ t.settings.about }}</h2>
      <p class="about-line">{{ t.appName }} {{ t.appNameEn }} v{{ t.version }}</p>
      <p class="hint">{{ t.settings.aboutLine }}</p>
      <p class="hint">© 2026 MogroWang Studio · MIT License</p>
    </section>

    <AppModal v-if="showChange" @close="!changing && (showChange = false)">
      <header class="modal-head">
        <h2>{{ t.settings.changeLocationTitle }}</h2>
        <button class="icon-btn" :aria-label="t.common.close" @click="showChange = false"><AppIcon name="x" /></button>
      </header>
      <div class="modal-body">
        <p class="hint">{{ t.settings.changeLocationDesc(dataPath) }}</p>
        <p v-if="changeError" class="error meta">{{ changeError }}</p>
      </div>
      <footer class="modal-foot">
        <button
          v-if="isCustomRoot"
          class="btn"
          :disabled="changing"
          @click="applyNewRoot(null)"
        >
          {{ t.settings.resetLocation }}
        </button>
        <span class="foot-spacer"></span>
        <button class="btn" :disabled="changing" @click="showChange = false">{{ t.common.cancel }}</button>
        <button class="btn btn-primary" :disabled="changing" @click="pickNewRoot">
          <AppIcon name="folder" :size="15" />
          {{ t.settings.changeLocationPick }}
        </button>
      </footer>
    </AppModal>
  </div>
</template>

<style scoped>
.page {
  padding: 28px 32px 48px;
  max-width: 720px;
}

.large-title {
  margin-bottom: 20px;
}

.group {
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: var(--r-m);
  padding: 16px 18px;
  margin-bottom: 14px;
}

.group-title {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 12px;
  color: var(--ink-2);
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 32px;
  flex-wrap: wrap;
}

.row > span:first-child {
  font-weight: 500;
  flex: none;
}

.path {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 11.5px;
  word-break: break-all;
}

.btn-sm {
  height: 28px;
  font-size: 12px;
}

.row-note {
  margin-top: 8px;
}

.error {
  color: var(--danger);
  margin-top: 10px;
}

.foot-spacer {
  flex: 1;
}

.about-line {
  font-weight: 600;
  margin-bottom: 2px;
}

@media (max-width: 860px) {
  .page {
    padding: 20px 16px 32px;
  }
}
</style>
