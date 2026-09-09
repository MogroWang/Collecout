<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useLibrariesStore } from './stores/libraries'
import { t } from './locales/strings'
import { isMobileLayout } from './lib/platform'
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
</script>

<template>
  <div class="app-shell" :class="{ mobile }">
    <!-- 桌面侧栏 -->
    <aside v-if="!mobile" class="sidebar">
      <div class="brand">
        <img src="/icon.svg" alt="" class="brand-mark" />
        <div class="brand-text">
          <span class="brand-name">{{ t.appName }}</span>
          <span class="brand-sub">{{ t.appNameEn }}</span>
        </div>
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
      <img src="/icon.svg" alt="" class="brand-mark" />
      <span class="brand-name">{{ t.appName }}</span>
    </header>

    <main class="main">
      <RouterView />
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

    <ToastHost />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100%;
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
  gap: 10px;
  padding: 2px 8px 14px;
}

.brand-mark {
  width: 30px;
  height: 30px;
  border-radius: 8px;
}

.brand-text {
  display: flex;
  flex-direction: column;
  line-height: 1.2;
}

.brand-name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 0.01em;
}

.brand-sub {
  font-size: 10px;
  color: var(--ink-3);
  letter-spacing: 0.08em;
  text-transform: uppercase;
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
  overflow-y: auto;
}

/* ---------- 移动端 ---------- */
.app-shell.mobile {
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

.app-shell.mobile .main {
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
