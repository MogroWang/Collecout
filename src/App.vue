<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useLibrariesStore } from './stores/libraries'
import { useUiStore } from './stores/ui'
import { t } from './locales/strings'
import { isDesktop, isMobileLayout, platform } from './lib/platform'
import { applySafeAreaInsets } from './lib/native'
import AppIcon from './components/AppIcon.vue'
import ToastHost from './components/ToastHost.vue'

const route = useRoute()
const libraries = useLibrariesStore()
const ui = useUiStore()

const mobile = ref(isMobileLayout())
const mq = window.matchMedia('(max-width: 860px)')
const onMqChange = (e: MediaQueryListEvent) => (mobile.value = e.matches)

onMounted(() => mq.addEventListener('change', onMqChange))
onBeforeUnmount(() => mq.removeEventListener('change', onMqChange))

/* 安卓 edge-to-edge：系统栏 insets 变化（旋转、分屏）时刷新 CSS 变量 */
if (platform() === 'capacitor') {
  onMounted(() => {
    void applySafeAreaInsets()
    window.addEventListener('resize', applySafeAreaInsets)
    window.addEventListener('orientationchange', applySafeAreaInsets)
  })
  onBeforeUnmount(() => {
    window.removeEventListener('resize', applySafeAreaInsets)
    window.removeEventListener('orientationchange', applySafeAreaInsets)
  })
}

const activeLibraryId = computed(() => (route.name === 'library' ? String(route.params.id) : ''))
/** OOBE 首启向导独占整个窗口 */
const fullscreen = computed(() => route.name === 'oobe')

/** 标题栏标题：各页面通过 ui store 声明，缺省回落到应用名 */
const titlebarTitle = computed(() => ui.pageTitle || t.appName)
/** 悬停控件时标题栏中间显示该控件的用途说明，否则显示页面标题 */
const isHint = computed(() => ui.hoverHint !== '')
const tbCenter = computed(() => (isHint.value ? ui.hoverHint : titlebarTitle.value))

/* ---------- 桌面标题栏（窗口控制 + 拖动） ---------- */
const maximized = ref(false)
let win: import('@tauri-apps/api/window').Window | null = null
let unlisten: (() => void) | null = null

onMounted(async () => {
  if (!isDesktop()) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    win = getCurrentWindow()
    // 窗口以隐藏方式启动，等数据加载完、首帧渲染好再亮出，避免白屏闪烁
    await win.show()
    maximized.value = await win.isMaximized()
    unlisten = await win.onResized(async () => {
      maximized.value = await win!.isMaximized()
    })
  } catch {
    /* 拿不到窗口句柄时按钮只是无效，不影响其他功能；Rust 端有 3 秒兜底显示 */
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
    <!-- 桌面标题栏：左 logo、中页面标题/悬停提示、右窗口药丸；空白处按住即可拖动窗口 -->
    <header v-if="isDesktop()" class="titlebar" data-tauri-drag-region>
      <RouterLink v-if="!fullscreen" to="/" class="tb-brand" :aria-label="t.hints.brand" v-hint="t.hints.brand">
        <img src="/logo-text.svg" alt="" class="tb-logo" />
      </RouterLink>
      <span v-else class="tb-brand">
        <img src="/logo-text.svg" alt="" class="tb-logo" />
      </span>
      <Transition name="hint" mode="out-in">
        <span :key="tbCenter" class="tb-title" :class="{ 'tb-hint': isHint }" data-tauri-drag-region>{{ tbCenter }}</span>
      </Transition>
      <div class="win-controls">
        <button class="wc-btn" :aria-label="t.titlebar.minimize" v-hint="t.hints.minimize" @click="minimize">
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 6h8" stroke="currentColor" stroke-width="1.2" /></svg>
        </button>
        <button class="wc-btn" :aria-label="maximized ? t.titlebar.restore : t.titlebar.maximize" v-hint="t.hints.maximize" @click="toggleMaximize">
          <svg v-if="!maximized" width="12" height="12" viewBox="0 0 12 12"><rect x="2.5" y="2.5" width="7" height="7" rx="1" fill="none" stroke="currentColor" stroke-width="1.2" /></svg>
          <svg v-else width="12" height="12" viewBox="0 0 12 12"><rect x="1.5" y="3.5" width="6" height="6" rx="1" fill="none" stroke="currentColor" stroke-width="1.1" /><path d="M4 3.5V2.6a1 1 0 0 1 1-1h4.4a1 1 0 0 1 1 1V7a1 1 0 0 1-1 1h-.9" fill="none" stroke="currentColor" stroke-width="1.1" /></svg>
        </button>
        <button class="wc-btn wc-close" :aria-label="t.titlebar.close" v-hint="t.hints.close" @click="closeWindow">
          <AppIcon name="x" :size="13" />
        </button>
      </div>
    </header>

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
        <!-- 桌面侧栏：悬浮圆角卡片，右下角可收起（收起后从标题栏展开） -->
        <aside v-if="!mobile" class="sidebar" :class="{ collapsed: ui.sidebarCollapsed }">
          <div class="sidebar-inner">
            <nav class="side-nav">
              <RouterLink class="nav-item" :class="{ on: route.name === 'home' }" to="/" v-hint="t.hints.navLibraries">
                <AppIcon name="library" :size="16" />
                {{ t.nav.libraries }}
              </RouterLink>
              <RouterLink class="nav-item" :class="{ on: route.name === 'templates' }" to="/templates" v-hint="t.hints.navTemplates">
                <AppIcon name="layers" :size="16" />
                {{ t.nav.templates }}
              </RouterLink>
              <RouterLink class="nav-item" :class="{ on: route.name === 'settings' }" to="/settings" v-hint="t.hints.navSettings">
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

            <footer class="side-foot">
              <span>v{{ t.version }}</span>
              <button
                class="icon-btn side-collapse"
                :aria-label="t.hints.sidebarCollapse"
                v-hint="t.hints.sidebarCollapse"
                @click="ui.sidebarCollapsed = true"
              >
                <AppIcon name="chevron-left" :size="15" />
              </button>
            </footer>
          </div>
        </aside>

        <!-- 侧边栏折叠后的悬浮展开把手：贴左缘垂直居中，桌面与 web 预览通用 -->
        <Transition name="fab">
          <button
            v-if="!mobile && ui.sidebarCollapsed"
            class="sidebar-fab"
            :aria-label="t.hints.sidebarExpand"
            v-hint="t.hints.sidebarExpand"
            @click="ui.sidebarCollapsed = false"
          >
            <AppIcon name="chevron-right" :size="16" />
          </button>
        </Transition>

        <!-- 移动端顶栏 -->
        <header v-if="mobile" class="m-topbar">
          <RouterLink to="/" class="m-logo-link" :aria-label="t.nav.libraries">
            <img src="/logo-text.svg" alt="" class="m-logo" />
          </RouterLink>
          <span class="m-version">v{{ t.version }}</span>
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
  /* 启动进场：窗口亮出时内容轻微上浮淡入，一次性（reduced-motion 下被全局压缩到 1ms） */
  animation: app-in 240ms var(--ease-sheet) both;
}

@keyframes app-in {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
}

/* ---------- 桌面标题栏 ---------- */
.titlebar {
  flex: none;
  position: relative;
  display: flex;
  align-items: center;
  height: 46px;
  padding: 0 10px 0 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--hairline);
  user-select: none;
  -webkit-user-select: none;
}

/* 侧边栏完全折叠后，贴左缘垂直居中的悬浮展开把手（web 预览没有标题栏，也能展开） */
.sidebar-fab {
  position: fixed;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 40;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 999px;
  background: var(--elevated);
  border: 1px solid var(--hairline);
  box-shadow: var(--shadow-1);
  color: var(--ink-2);
}

.sidebar-fab:hover {
  color: var(--ink);
  border-color: var(--hairline-strong);
}

/* 与按钮的 translateY(-50%) 共存的进出过渡 */
.fab-enter-active {
  transition: opacity 150ms ease, transform 200ms var(--ease-sheet);
}

.fab-leave-active {
  transition: opacity 120ms ease, transform 140ms ease-in;
}

.fab-enter-from,
.fab-leave-to {
  opacity: 0;
  transform: translateY(-50%) translateX(-8px);
}

.tb-brand {
  display: inline-flex;
  flex: none;
  border-radius: 6px;
  transition: opacity 150ms ease, transform 120ms ease-out;
}

.tb-brand:hover {
  opacity: 0.8;
}

.tb-brand:active {
  transform: scale(0.97);
}

.tb-logo {
  height: 24px;
  width: auto;
  display: block;
}

.tb-title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  max-width: min(46%, 420px);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 1.3rem;
  font-weight: 600;
  color: var(--ink-2);
}

/* 悬停提示与页面标题共用同一位置，视觉上略轻一级 */
.tb-title.tb-hint {
  font-weight: 500;
  color: var(--ink-3);
}

/* 提示 ↔ 标题的快速交叉切换：轻位移淡入，同路径退出 */
.hint-enter-active {
  transition: opacity 130ms ease, transform 130ms var(--ease-sheet);
}

.hint-leave-active {
  transition: opacity 80ms ease;
}

.hint-enter-from {
  opacity: 0;
  transform: translateX(-50%) translateY(3px);
}

.hint-leave-to {
  opacity: 0;
  transform: translateX(-50%);
}

/* 窗口药丸控件：收在标题栏右侧 */
.win-controls {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 30px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--hairline);
}

.wc-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 24px;
  border-radius: 999px;
  color: var(--ink-2);
  transition: background 120ms ease, color 120ms ease;
}

.wc-btn:hover {
  background: var(--surface-2);
  color: var(--ink);
}

.wc-btn:active {
  transform: scale(0.94);
}

.wc-close:hover {
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

/* ---------- 侧栏：悬浮圆角卡片 ---------- */
.sidebar {
  flex: none;
  width: var(--sidebar-w);
  margin: 10px 2px 10px 10px;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--hairline);
  border-radius: 14px;
  box-shadow: var(--shadow-1);
  transition:
    width 300ms var(--ease-sheet),
    margin 300ms var(--ease-sheet),
    border-color 200ms ease,
    opacity 180ms ease;
}

/* 折叠：宽度、外边距与边框全部收到 0（透明但占位的边框会让侧栏残留 2px），
   内容整体淡出；内层定宽避免重排抖动 */
.sidebar.collapsed {
  width: 0;
  margin-left: 0;
  margin-right: 0;
  border-width: 0;
  opacity: 0;
  pointer-events: none;
}

.sidebar-inner {
  width: var(--sidebar-w);
  height: 100%;
  display: flex;
  flex-direction: column;
  padding: 12px 10px 10px;
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
  font-size: 1.1rem;
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
  font-size: 1.1rem;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}

.side-empty {
  padding: 0 10px;
}

.side-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 10px 2px;
  font-size: 1.1rem;
  color: var(--ink-3);
}

/* 侧栏右下角的收起按钮 */
.side-collapse {
  width: 24px;
  height: 24px;
  color: var(--ink-3);
}

.side-collapse:hover {
  color: var(--ink);
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

/* 安卓 edge-to-edge：顶栏背景延伸到状态栏下，内容避让取 env() 与插件注入值中较大者 */
.m-topbar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: calc(52px + max(env(safe-area-inset-top), var(--safe-top)));
  padding: max(env(safe-area-inset-top), var(--safe-top)) 16px 0;
  background: var(--surface);
  border-bottom: 1px solid var(--hairline);
}

.m-logo-link {
  display: inline-flex;
  border-radius: 6px;
  transition: opacity 150ms ease, transform 120ms ease-out;
}

.m-logo-link:hover {
  opacity: 0.8;
}

.m-logo-link:active {
  transform: scale(0.97);
}

.m-logo {
  height: 28px;
  width: auto;
  display: block;
}

.m-version {
  margin-left: auto;
  font-size: 1.2rem;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
}

.app-frame.mobile .main {
  padding-bottom: calc(56px + max(env(safe-area-inset-bottom), var(--safe-bottom)));
}

.m-tabbar {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  height: calc(56px + max(env(safe-area-inset-bottom), var(--safe-bottom)));
  padding-bottom: max(env(safe-area-inset-bottom), var(--safe-bottom));
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
  font-size: 1rem;
  color: var(--ink-3);
  text-decoration: none;
}

.tab-item.on {
  color: var(--accent);
}
</style>
