<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useLibrariesStore } from './stores/libraries'
import { t } from './locales/strings'
import { isDesktop, isMobileLayout } from './lib/platform'
import AppIcon from './components/AppIcon.vue'
import ToastHost from './components/ToastHost.vue'

const route = useRoute()
const libraries = useLibrariesStore()

const mobile = ref(isMobileLayout())
const mq = window.matchMedia('(max-width: 860px)')
const onMqChange = (e: MediaQueryListEvent) => (mobile.value = e.matches)

onMounted(() => mq.addEventListener('change', onMqChange))
onBeforeUnmount(() => mq.removeEventListener('change', onMqChange))

const activeLibraryId = computed(() => (route.name === 'library' ? String(route.params.id) : ''))
/** OOBE 首启向导独占整个窗口 */
const fullscreen = computed(() => route.name === 'oobe')

/* ---------- 自定义标题栏（仅桌面端） ---------- */
const maximized = ref(false)
let win: import('@tauri-apps/api/window').Window | null = null
let unlisten: (() => void) | null = null

onMounted(async () => {
  if (!isDesktop()) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    win = getCurrentWindow()
    maximized.value = await win.isMaximized()
    unlisten = await win.onResized(async () => {
      maximized.value = await win!.isMaximized()
    })
  } catch {
    /* 拿不到窗口句柄时按钮只是无效，不影响其他功能 */
  }
})
onBeforeUnmount(() => unlisten?.())

async function minimize() {
  await win?.minimize()
}
async function toggleMaximize() {
  await win?.toggleMaximize()
}
async function closeWindow() {
  await win?.close()
}
</script>

<template>
  <div class="app-frame" :class="{ mobile }">
    <!-- 自定义标题栏：替代系统原生标题栏，可拖动窗口 -->
    <div v-if="isDesktop()" class="titlebar" data-tauri-drag-region>
      <div class="tb-brand" data-tauri-drag-region>
        <img src="/logo-text.svg" alt="" class="tb-logo" />
      </div>
      <div class="tb-actions">
        <button class="tb-btn" :aria-label="t.titlebar.minimize" @click="minimize">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6h8" stroke="currentColor" stroke-width="1.2" /></svg>
        </button>
        <button class="tb-btn" :aria-label="maximized ? t.titlebar.restore : t.titlebar.maximize" @click="toggleMaximize">
          <svg v-if="!maximized" width="12" height="12" viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" /></svg>
          <svg v-else width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="3.5" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.1" /><path d="M4 3.5V2.6a1 1 0 0 1 1-1h4.4a1 1 0 0 1 1 1V7a1 1 0 0 1-1 1h-.9" fill="none" stroke="currentColor" stroke-width="1.1" /></svg>
        </button>
        <button class="tb-btn tb-close" :aria-label="t.titlebar.close" @click="closeWindow">
          <AppIcon name="x" :size="13" />
        </button>
      </div>
    </div>

    <!-- OOBE 独占窗口 -->
    <main v-if="fullscreen" class="main main-fullscreen">
      <RouterView v-slot="{ Component }">
        <Transition name="page" mode="out-in">
          <component :is="Component" :key="route.path" />
        </Transition>
      </RouterView>
    </main>

    <template v-else>
      <div class="app-shell">
        <!-- 桌面侧栏 -->
        <aside v-if="!mobile" class="sidebar">
          <div class="brand">
            <img src="/logo-text.svg" alt="" class="brand-logo" />
          </div>

          <nav class="side-nav">
            <RouterLink class="nav-item" :class="{ on: route.name === 'home' }" to="/">
              <AppIcon name="library" :size="16" />
              {{ t.nav.libraries }}
            </RouterLink>
            <RouterLink class="nav-item" :class="{ on: route.name === 'templates' }" to="/templates">
              <AppIcon name="layers" :size="16" />
              {{ t.nav.templates }}
            </RouterLink>
            <RouterLink class="nav-item" :class="{ on: route.name === 'settings' }" to="/settings">
              <AppIcon name="gear" :size="16" />
              {{ t.nav.settings }}
            </RouterLink>
          </nav>

          <div class="side-libraries">
            <div class="side-label">{{ t.nav.libraries }}</div>
            <RouterLink
              v-for="lib in libraries.libraries"
              :key="lib.id"
              class="lib-item"
              :class="{ on: activeLibraryId === lib.id }"
              :to="`/library/${lib.id}`"
            >
              <span class="lib-name">{{ lib.name }}</span>
              <span class="lib-count">{{ lib.entries.length }}</span>
            </RouterLink>
            <p v-if="libraries.libraries.length === 0" class="hint side-empty">{{ t.home.emptyTitle }}</p>
          </div>

          <footer class="side-foot">v{{ t.version }}</footer>
        </aside>

        <!-- 移动端顶栏 -->
        <header v-if="mobile" class="m-topbar">
          <img src="/logo-text.svg" alt="" class="m-logo" />
        </header>

        <main class="main">
          <RouterView v-slot="{ Component }">
            <Transition name="page" mode="out-in">
              <component :is="Component" :key="route.path" />
            </Transition>
          </RouterView>
        </main>

        <!-- 移动端底部导航 -->
        <nav v-if="mobile" class="m-tabbar">
          <RouterLink class="tab-item" :class="{ on: route.name === 'home' || route.name === 'library' }" to="/">
            <AppIcon name="library" :size="20" />
            {{ t.nav.libraries }}
          </RouterLink>
          <RouterLink class="tab-item" :class="{ on: route.name === 'templates' }" to="/templates">
            <AppIcon name="layers" :size="20" />
            {{ t.nav.templates }}
          </RouterLink>
          <RouterLink class="tab-item" :class="{ on: route.name === 'settings' }" to="/settings">
            <AppIcon name="gear" :size="20" />
            {{ t.nav.settings }}
          </RouterLink>
        </nav>
      </div>
    </template>

    <ToastHost />
  </div>
</template>

<style scoped>
.app-frame {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* ---------- 自定义标题栏 ---------- */
.titlebar {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 38px;
  padding-left: 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--hairline);
  user-select: none;
  -webkit-user-select: none;
}

.tb-brand {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.tb-logo {
  height: 15px;
  width: auto;
  display: block;
}

.tb-actions {
  display: flex;
  align-self: stretch;
}

.tb-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  align-self: stretch;
  color: var(--ink-2);
  border-radius: 0;
  transition: background 120ms ease, color 120ms ease;
}

.tb-btn:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.tb-btn:active {
  transform: none;
}

.tb-close:hover {
  background: var(--danger);
  color: #fff;
}

/* ---------- 主体 ---------- */
.app-shell {
  flex: 1;
  min-height: 0;
  display: flex;
}

.main-fullscreen {
  flex: 1;
  min-height: 0;
}

/* ---------- 侧栏 ---------- */
.sidebar {
  flex: none;
  width: var(--sidebar-w);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-right: 1px solid var(--hairline);
  padding: 14px 10px 10px;
}

.brand {
  display: flex;
  align-items: center;
  padding: 6px 8px 14px;
}

.brand-logo {
  height: 21px;
  width: auto;
  display: block;
}

.side-nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 32px;
  padding: 0 10px;
  border-radius: var(--r-s);
  color: var(--ink-2);
  font-weight: 500;
  text-decoration: none;
  transition: background 150ms ease, color 150ms ease;
}

.nav-item:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.nav-item.on {
  background: var(--accent-soft);
  color: var(--accent);
}

.side-libraries {
  flex: 1;
  overflow-y: auto;
  margin-top: 18px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.side-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-3);
  padding: 0 10px 6px;
  letter-spacing: 0.04em;
}

.lib-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 30px;
  padding: 0 10px;
  border-radius: var(--r-s);
  color: var(--ink-2);
  text-decoration: none;
  transition: background 150ms ease, color 150ms ease;
}

.lib-item:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.lib-item.on {
  background: var(--accent-soft);
  color: var(--accent);
}

.lib-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.lib-count {
  font-size: 11px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}

.side-empty {
  padding: 0 10px;
}

.side-foot {
  padding: 10px 10px 2px;
  font-size: 11px;
  color: var(--ink-3);
}

/* ---------- 主区 ---------- */
.main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
}

/* ---------- 移动端 ---------- */
.app-frame.mobile {
  flex-direction: column;
}

.app-frame.mobile .app-shell {
  flex-direction: column;
}

.m-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 52px;
  padding: 0 16px;
  padding-top: env(safe-area-inset-top);
  background: var(--surface);
  border-bottom: 1px solid var(--hairline);
}

.m-logo {
  height: 17px;
  width: auto;
  display: block;
}

.app-frame.mobile .main {
  padding-bottom: calc(56px + env(safe-area-inset-bottom));
}

.m-tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  height: calc(56px + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: var(--surface);
  border-top: 1px solid var(--hairline);
  z-index: 10;
}

.tab-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-size: 10px;
  color: var(--ink-3);
  text-decoration: none;
}

.tab-item.on {
  color: var(--accent);
}
</style>
