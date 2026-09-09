<script setup lang="ts">
import { ref } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { t } from '../locales/strings'
import { isDesktop } from '../lib/platform'
import AppIcon from '../components/AppIcon.vue'

const settings = useSettingsStore()
const dataPath = ref('')

if (isDesktop()) {
  void import('@tauri-apps/api/path').then(({ appDataDir }) => {
    appDataDir().then((dir) => (dataPath.value = `${dir.replace(/\/$/, '')}/collecout`))
  })
}

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
        <select
          class="select"
          :value="settings.settings.defaultExportFormat"
          @change="settings.set({ defaultExportFormat: ($event.target as HTMLSelectElement).value as never })"
        >
          <option v-for="opt in formatOptions" :key="opt.id" :value="opt.id">{{ opt.label }}</option>
        </select>
      </div>
    </section>

    <section class="group">
      <h2 class="group-title">{{ t.settings.data }}</h2>
      <div class="row">
        <span>{{ t.settings.dataLocation }}</span>
        <span class="path meta">{{ isDesktop() ? dataPath : t.settings.dataLocalNote }}</span>
        <button v-if="isDesktop() && dataPath" class="btn btn-sm" @click="openDataFolder">
          <AppIcon name="folder" :size="14" />
          {{ t.settings.openDataFolder }}
        </button>
      </div>
      <p class="hint row-note">库与模板以 JSON 文件保存在这里，可以直接备份或同步。</p>
    </section>

    <section class="group">
      <h2 class="group-title">{{ t.settings.about }}</h2>
      <p class="about-line">{{ t.appName }} {{ t.appNameEn }} v{{ t.version }}</p>
      <p class="hint">{{ t.settings.aboutLine }}</p>
      <p class="hint">© 2026 MogroWang Studio · MIT License</p>
    </section>
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
