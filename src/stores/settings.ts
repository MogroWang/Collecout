import { defineStore } from 'pinia'
import type { Settings, ThemeMode } from '../core/models'
import { repo } from '../core/storage/repo'

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    settings: { theme: 'system', defaultExportFormat: 'markdown' } as Settings,
  }),
  getters: {
    resolvedTheme: (s) => resolveTheme(s.settings.theme),
  },
  actions: {
    async load() {
      this.settings = await repo().loadSettings()
      this.apply()
    },
    apply() {
      document.documentElement.dataset.theme = resolveTheme(this.settings.theme)
    },
    watchSystem() {
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        if (this.settings.theme === 'system') this.apply()
      })
    },
    async set(partial: Partial<Settings>) {
      this.settings = { ...this.settings, ...partial }
      this.apply()
      await repo().saveNow('settings.json', { settings: this.settings })
    },
  },
})
