import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { initRepo, repo } from './core/storage/repo'
import { useSettingsStore } from './stores/settings'
import { useLibrariesStore } from './stores/libraries'
import { useTemplatesStore } from './stores/templates'
import './styles/base.css'

async function bootstrap() {
  await initRepo()
  const app = createApp(App)
  const pinia = createPinia()
  app.use(pinia)
  if (import.meta.env.DEV) {
    // 开发调试：控制台可拿到 pinia 实例驱动 store
    ;(window as unknown as Record<string, unknown>).__pinia = pinia
  }

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
}

void bootstrap()
