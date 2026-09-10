<script setup lang="ts">
import { ref } from 'vue'
import { t } from '../locales/strings'
import { openInBrowser } from '../lib/desktop'
import AppIcon from '../components/AppIcon.vue'

const REPO_RELEASES = 'https://github.com/MogroWang/Collecout/releases'
const LATEST_API = 'https://api.github.com/repos/MogroWang/Collecout/releases/latest'

type UpdateState = 'idle' | 'checking' | 'latest' | 'available' | 'error'

const state = ref<UpdateState>('idle')
const latestVersion = ref('')
const releaseUrl = ref('')

/** 比较 semver（只认 major.minor.patch，忽略前缀 v） */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/i, '').split('.')
  const pb = b.replace(/^v/i, '').split('.')
  for (let i = 0; i < 3; i++) {
    const d = (Number(pa[i]) || 0) - (Number(pb[i]) || 0)
    if (d !== 0) return d
  }
  return 0
}

async function checkUpdate() {
  state.value = 'checking'
  try {
    const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json' } })
    // 404 = 仓库还没有任何发布版本，当前版本即最新
    if (res.status === 404) {
      state.value = 'latest'
      return
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { tag_name?: string; html_url?: string }
    latestVersion.value = String(data.tag_name ?? '').replace(/^v/i, '')
    releaseUrl.value = data.html_url ?? REPO_RELEASES
    state.value = latestVersion.value === '' ? 'error' : compareVersions(latestVersion.value, t.version) > 0 ? 'available' : 'latest'
  } catch {
    state.value = 'error'
  }
}

function openRelease() {
  void openInBrowser(releaseUrl.value || REPO_RELEASES)
}
</script>

<template>
  <div class="page">
    <header class="page-head">
      <button class="icon-btn" :aria-label="t.common.back" @click="$router.back()">
        <AppIcon name="arrow-left" />
      </button>
      <h1 class="large-title">{{ t.about.title }}</h1>
    </header>

    <div class="about-card card">
      <img src="/logo-text.svg" alt="" class="about-logo" />
      <p class="meta version">v{{ t.version }}</p>
      <p class="hint tagline">{{ t.settings.aboutLine }}</p>

      <div class="update-row">
        <button class="btn" :disabled="state === 'checking'" @click="checkUpdate">
          <AppIcon name="refresh" :size="15" />
          {{ state === 'checking' ? t.about.checking : t.about.checkUpdate }}
        </button>
        <span v-if="state === 'latest'" class="hint up-to-date">
          <AppIcon name="check" :size="14" />
          {{ t.about.upToDate(t.version) }}
        </span>
        <template v-else-if="state === 'available'">
          <span class="chip">{{ t.about.newVersion(latestVersion) }}</span>
          <button class="btn btn-primary" @click="openRelease">
            <AppIcon name="export" :size="15" />
            {{ t.about.gotoRelease }}
          </button>
        </template>
        <span v-else-if="state === 'error'" class="hint error">{{ t.about.checkFailed }}</span>
      </div>

      <footer class="about-foot">
        <p class="hint">© 2026 MogroWang Studio · MIT License</p>
        <button class="btn btn-ghost btn-sm" @click="openRelease">
          <AppIcon name="doc" :size="14" />
          {{ t.about.releasesPage }}
        </button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.page {
  padding: 28px 32px 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.page-head {
  width: 100%;
  max-width: 560px;
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
}

.about-card {
  width: min(560px, 100%);
  padding: 36px 32px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  text-align: center;
}

.about-logo {
  height: 40px;
  width: auto;
  margin-bottom: 6px;
}

.version {
  font-variant-numeric: tabular-nums;
  margin-top: 2px;
}

.tagline {
  max-width: 360px;
  margin-bottom: 18px;
}

.update-row {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 16px;
  border-top: 1px solid var(--hairline);
  width: 100%;
}

.up-to-date {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: var(--accent);
}

.error {
  color: var(--danger);
}

.about-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 22px;
  padding-top: 12px;
  border-top: 1px solid var(--hairline);
  width: 100%;
}

.btn-sm {
  height: 28px;
  font-size: 12px;
}

@media (max-width: 860px) {
  .page {
    padding: 20px 16px 32px;
  }
}
</style>
