<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { repo } from '../core/storage/repo'
import { useSettingsStore } from '../stores/settings'
import { useLibrariesStore } from '../stores/libraries'
import { useTemplatesStore } from '../stores/templates'
import { t } from '../locales/strings'
import { pickDirectory } from '../lib/desktop'
import AppIcon from '../components/AppIcon.vue'

const router = useRouter()
const settings = useSettingsStore()
const libraries = useLibrariesStore()
const templates = useTemplatesStore()

const mode = ref<'default' | 'existing' | 'custom'>('default')
const defaultPath = ref('')
const customPath = ref('')
/** 探测到的现有数据文件夹（绝对路径）；非空时显示「读取现有数据」卡片 */
const existingRoots = ref<string[]>([])
const existingPath = ref('')
const picking = ref(false)
const starting = ref(false)
const error = ref('')

onMounted(async () => {
  defaultPath.value = await repo().describeDefaultRoot()
  existingRoots.value = (await repo().adapter.probeExistingRoots?.()) ?? []
  if (existingRoots.value.length > 0) existingPath.value = existingRoots.value[0]
})

/** 自定义位置校验通过后才允许开始 */
const customReady = computed(() => customPath.value !== '' && error.value === '')

/** 自定义选中的文件夹是否含现有数据（chip 提示「将读取其中的现有数据」） */
const customHasData = ref(false)

const canStart = computed(() => {
  if (starting.value || picking.value) return false
  if (mode.value === 'default') return true
  if (mode.value === 'existing') return existingPath.value !== ''
  return customReady.value
})

/** 选中某个探测到的现有数据文件夹 */
function chooseExisting(path: string) {
  if (starting.value) return
  mode.value = 'existing'
  existingPath.value = path
  error.value = ''
}

function pickCustom() {
  if (picking.value) return
  error.value = ''
  void (async () => {
    picking.value = true
    try {
      const dir = await pickDirectory()
      if (!dir) return
      // 非空文件夹：若是萃序数据文件夹（换电脑接回备份、旧版本数据等）则允许直接读取
      const entries = await repo().adapter.listDirAbs?.(dir)
      if (entries && entries.length > 0) {
        if (await repo().adapter.looksLikeDataDir?.(dir)) {
          customPath.value = dir
          customHasData.value = true
          mode.value = 'custom'
          return
        }
        error.value = t.oobe.notEmpty
        customPath.value = ''
        customHasData.value = false
        return
      }
      if (!(await repo().canWriteAbs(dir))) {
        error.value = t.oobe.notWritable
        customPath.value = ''
        customHasData.value = false
        return
      }
      customPath.value = dir
      customHasData.value = false
      mode.value = 'custom'
    } finally {
      picking.value = false
    }
  })()
}

function chooseMode(next: 'default' | 'custom') {
  if (starting.value) return
  if (mode.value === next) return
  mode.value = next
  if (next === 'custom' && customPath.value === '') {
    // 首次切换到自定义：提示需要空文件夹，用户点击卡片内的按钮确认后弹出选择窗口
    error.value = ''
  }
}

async function start() {
  starting.value = true
  error.value = ''
  const target = mode.value === 'default' ? null : mode.value === 'existing' ? existingPath.value : customPath.value
  try {
    await repo().setDataRoot(target)
    await Promise.all([settings.load(), libraries.load(), templates.load()])
    await router.replace('/')
  } catch (err) {
    error.value = err instanceof Error ? err.message : t.oobe.notWritable
    starting.value = false
  }
}
</script>

<template>
  <div class="oobe">
    <div class="oobe-card card">
      <div class="hero">
        <img src="/icon.svg" alt="" class="hero-icon" />
        <h1>{{ t.oobe.welcome }}</h1>
        <p class="meta">{{ t.oobe.intro }}</p>
      </div>

      <h2 class="loc-title">{{ t.oobe.locationTitle }}</h2>
      <p class="hint loc-desc">{{ t.oobe.locationDesc }}</p>

      <button class="loc-card card clickable" :class="{ on: mode === 'default' }" type="button" @click="chooseMode('default')">
        <span class="loc-head">
          <AppIcon name="folder" :size="16" />
          <strong>{{ t.oobe.defaultOption }}</strong>
        </span>
        <span class="hint">{{ t.oobe.defaultOptionDesc }}</span>
        <span class="loc-path meta">{{ defaultPath }}</span>
      </button>

      <!-- 检测到旧版本 / 兜底位置的现有数据时出现：选中即原样读取 -->
      <div v-if="existingRoots.length > 0" class="loc-card card" :class="{ on: mode === 'existing' }">
        <span class="loc-head">
          <AppIcon name="import" :size="16" />
          <strong>{{ t.oobe.existingOption }}</strong>
        </span>
        <span class="hint">{{ t.oobe.existingOptionDesc }}</span>
        <label v-for="p in existingRoots" :key="p" class="existing-row">
          <input type="radio" name="existing-root" :value="p" :checked="mode === 'existing' && existingPath === p" @change="chooseExisting(p)" />
          <span class="loc-path meta">{{ p }}</span>
        </label>
      </div>

      <button
        class="loc-card card clickable"
        :class="{ on: mode === 'custom' }"
        type="button"
        @click="mode === 'custom' ? pickCustom() : chooseMode('custom')"
      >
        <span class="loc-head">
          <AppIcon name="library" :size="16" />
          <strong>{{ t.oobe.customOption }}</strong>
          <span v-if="customReady" class="chip loc-chip">{{ customHasData ? t.oobe.customHasData : t.oobe.customPicked }}</span>
        </span>
        <span v-if="customPath" class="loc-path meta">{{ customPath }}</span>
        <span v-else class="hint">{{ t.oobe.customHint }}</span>
        <!-- 已切到自定义且还没选路径：点卡片本身即视为确认，直接弹出选择窗口 -->
        <span v-if="mode === 'custom' && !customPath && !picking" class="pick-inline meta">
          <AppIcon name="folder" :size="14" />
          {{ t.oobe.pickFolder }}
        </span>
      </button>

      <p v-if="error" class="error meta">{{ error }}</p>

      <div class="oobe-foot">
        <button class="btn btn-primary" :disabled="!canStart" @click="start">
          <AppIcon name="check" :size="15" />
          {{ starting ? t.oobe.starting : t.oobe.start }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.oobe {
  min-height: 100%;
  display: grid;
  place-items: center;
  padding: 32px 24px;
}

.oobe-card {
  width: min(560px, 100%);
  padding: 32px 34px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  text-align: center;
  margin-bottom: 10px;
}

.hero-icon {
  width: 56px;
  height: 56px;
  margin-bottom: 4px;
}

.hero h1 {
  font-size: 2.2rem;
  font-weight: 700;
  letter-spacing: -0.01em;
}

.loc-title {
  font-size: 1.5rem;
  font-weight: 600;
}

.loc-desc {
  margin-top: -6px;
}

.loc-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 13px 16px;
  text-align: left;
  transition: border-color 150ms ease, background 150ms ease, box-shadow 150ms ease;
}

.loc-card.on {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.loc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.loc-chip {
  margin-left: auto;
}

.loc-path {
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 1.15rem;
  word-break: break-all;
}

/* 现有数据候选：单选行 */
.existing-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  margin: 0 -8px;
  border-radius: var(--r-s);
  cursor: pointer;
  transition: background 150ms ease;
}

.existing-row:hover {
  background: var(--surface-2);
}

.existing-row input {
  margin: 2px 0 0;
  accent-color: var(--accent);
}

.pick-inline {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  color: var(--accent);
  font-weight: 600;
}

.error {
  color: var(--danger);
}

.oobe-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
