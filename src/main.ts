import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { initRepo, repo } from './core/storage/repo'
import { useSettingsStore } from './stores/settings'
import { useLibrariesStore } from './stores/libraries'
import { useTemplatesStore } from './stores/templates'
import { useUiStore } from './stores/ui'
import { isDesktop } from './lib/platform'
import './styles/base.css'

/* ---------- 启动界面（index.html 静态层） ----------
 * 淡出时机：数据就绪且至少展示 1.4s，避免一闪而过；桌面窗口隐藏到首帧，直接移除。 */
const SPLASH_MIN_MS = 1400
const bootStart = performance.now()

function dismissSplash(): void {
  const el = document.getElementById('splash')
  if (!el) return
  if (isDesktop()) {
    el.remove()
    return
  }
  // 跟随已解析的主题换底色，避免深色用户在淡出瞬间撞上白屏
  el.style.background = document.documentElement.dataset.theme === 'dark' ? '#1b1b1d' : ''
  el.classList.add('leaving')
  el.addEventListener('animationend', () => el.remove(), { once: true })
}

async function bootstrap() {
  await initRepo()
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  if (import.meta.env.DEV) {
    // 开发调试：控制台可拿到 pinia 实例驱动 store
    ;(window as unknown as Record<string, unknown>).__pinia = pinia
  }

  // v-hint：悬停控件时把用途说明显示到桌面标题栏中间，移开或点击后恢复页面标题
  app.directive('hint', {
    mounted(el: HTMLElement, binding) {
      const show = () => useUiStore().setHoverHint(binding.value as string)
      const hide = () => useUiStore().setHoverHint(null)
      el.addEventListener('mouseenter', show)
      el.addEventListener('mouseleave', hide)
      el.addEventListener('click', hide)
    },
    updated(el: HTMLElement, binding) {
      // 悬停期间文案被更新时（如语言/状态变化）同步刷新
      if (binding.value !== binding.oldValue && el.matches(':hover')) {
        useUiStore().setHoverHint(binding.value as string)
      }
    },
    unmounted(el: HTMLElement) {
      // 组件随视图切换销毁时若提示还挂着，清掉避免标题栏残留
      if (el.matches(':hover')) useUiStore().setHoverHint(null)
    },
  })

  const settings = useSettingsStore()
  await settings.load()
  settings.watchSystem()

  // 首次启动（还没有数据文件夹）：先不加载业务数据，进入 OOBE 询问数据存放位置
  const onboarding = await repo().needsOnboarding()
  if (!onboarding) {
    await Promise.all([useLibrariesStore().load(), useTemplatesStore().load()])
  }

  app.use(router)
  app.mount('#app')

  if (onboarding) await router.replace('/oobe')

  // 启动层至少展示 SPLASH_MIN_MS：加载快时补足剩余时间，加载慢时立刻开始淡出
  setTimeout(dismissSplash, Math.max(0, SPLASH_MIN_MS - (performance.now() - bootStart)))
}

void bootstrap()
