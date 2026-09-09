import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { initRepo } from './core/storage/repo'
import { useSettingsStore } from './stores/settings'
import { useLibrariesStore } from './stores/libraries'
import { useTemplatesStore } from './stores/templates'
import './styles/base.css'

async function bootstrap() {
  await initRepo()
  const app = createApp(App)
  app.use(createPinia())

  const settings = useSettingsStore()
  await settings.load()
  settings.watchSystem()

  await Promise.all([useLibrariesStore().load(), useTemplatesStore().load()])

  app.use(router)
  app.mount('#app')
}

void bootstrap()
