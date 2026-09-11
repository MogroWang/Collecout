<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useSettingsStore } from '../stores/settings'
import { useLibrariesStore } from '../stores/libraries'
import { useTemplatesStore } from '../stores/templates'
import { useUiStore } from '../stores/ui'
import { repo } from '../core/storage/repo'
import { t } from '../locales/strings'
import { isDesktop, platform } from '../lib/platform'
import AppIcon from '../components/AppIcon.vue'
import AppModal from '../components/AppModal.vue'
import AppSelect from '../components/AppSelect.vue'

const settings = useSettingsStore()
const libraries = useLibrariesStore()
const templates = useTemplatesStore()
const ui = useUiStore()
const router = useRouter()
ui.setPageTitle(t.settings.title)

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

/* ---------- 界面字体 ---------- */
const FONT_PRESET_IDS = ['system', 'serif', 'kai', 'mono'] as const

const fontOptions = [
  { value: 'system', label: t.settings.fontSystem },
  { value: 'serif', label: t.settings.fontSerif },
  { value: 'kai', label: t.settings.fontKai },
  { value: 'mono', label: t.settings.fontMono },
  { value: 'custom', label: t.settings.fontCustom },
]

/** 是否处于「自定义」输入模式（下拉选「自定义…」进入；恢复选预设时退出） */
const isPreset = (v: string) => (FONT_PRESET_IDS as readonly string[]).includes(v)
const fontCustomMode = ref(!isPreset(settings.settings.fontFamily))
/** 自定义输入框的草稿；进入自定义模式时预填当前自定义值 */
const customFontDraft = ref(fontCustomMode.value ? settings.settings.fontFamily : '')

const fontSelection = computed(() =>
  !fontCustomMode.value && isPreset(settings.settings.fontFamily) ? settings.settings.fontFamily : 'custom',
)

function onFontPreset(value: string) {
  if (value === 'custom') {
    // 只切换到自定义输入模式，不立即改设置——等用户输入（或保留已有自定义值）后再持久化
    fontCustomMode.value = true
    customFontDraft.value = isPreset(settings.settings.fontFamily) ? '' : settings.settings.fontFamily
    return
  }
  fontCustomMode.value = false
  customFontDraft.value = ''
  void settings.set({ fontFamily: value })
}

function onCustomFontInput() {
  const v = customFontDraft.value.trim()
  // 输入被清空时保持原设置不动，等用户选回预设或输入新字体名
  if (v) void settings.set({ fontFamily: v })
}

const formatOptions = [
  { id: 'markdown', label: 'Markdown' },
  { id: 'text', label: t.exportDialog.fmtText },
  { id: 'csv', label: 'CSV' },
  { id: 'json', label: 'JSON' },
  { id: 'xlsx', label: t.exportDialog.fmtXlsx },
  { id: 'docx', label: t.exportDialog.fmtDocx },
] as const

async function setTheme(id: 'system' | 'light' | 'dark') {
  await settings.set({ theme: id })
}

async function openDataFolder() {
  try {
    const { revealInFinder } = await import('../lib/desktop')
    await revealInFinder(dataPath.value, true)
  } catch {
    // 常见于数据文件夹被移动/删除，或系统拒绝打开
    ui.toast(t.settings.openFailed, 'danger')
  }
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
            <i class="swatch" :class="`sw-${opt.id}`" aria-hidden="true" />
            {{ opt.label }}
          </button>
        </div>
      </div>
      <div class="row font-row">
        <span>{{ t.settings.font }}</span>
        <AppSelect
          :model-value="fontSelection"
          :options="fontOptions"
          @update:model-value="onFontPreset($event as string)"
        />
        <input
          v-if="fontSelection === 'custom'"
          v-model="customFontDraft"
          class="input font-input"
          type="text"
          :placeholder="t.settings.fontCustomPlaceholder"
          @change="onCustomFontInput"
        />
      </div>
      <p class="hint row-note font-preview">{{ t.settings.fontPreview }}</p>
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
      <div class="row">
        <span class="about-line">{{ t.appName }} {{ t.appNameEn }} v{{ t.version }}</span>
        <button class="btn btn-sm" @click="router.push('/about')">
          <AppIcon name="refresh" :size="14" />
          {{ t.settings.openAbout }}
        </button>
      </div>
      <p class="hint">{{ t.settings.aboutLine }}</p>
      <p class="hint">© 2026 MogroWang Studio · MIT License</p>
    </section>

    <AppModal :open="showChange" @close="!changing && (showChange = false)">
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

/* 组内多行控件之间留出呼吸感 */
.row + .row {
  margin-top: 12px;
}

.row > span:first-child {
  font-weight: 500;
  flex: none;
  margin-right: auto;
}

/* 主题选项的颜色预览 */
.swatch {
  display: inline-block;
  width: 13px;
  height: 13px;
  border-radius: 4px;
  border: 1px solid var(--hairline-strong);
  vertical-align: -2px;
}

.sw-system {
  background: linear-gradient(135deg, #f4f3f0 50%, #1b1b1d 50%);
}

.sw-light {
  background: #f4f3f0;
}

.sw-dark {
  background: #1b1b1d;
}

/* 自定义字体输入框：与下拉之间留出明显间隔 */
.font-input {
  width: 220px;
  margin-left: 8px;
}

/* 预览文本继承全局 --font（随上方选择即时更新） */
.font-preview {
  font-size: 15px;
  color: var(--ink);
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
