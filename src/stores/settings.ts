import { defineStore } from 'pinia'
import type { Settings, ThemeMode } from '../core/models'
import { repo } from '../core/storage/repo'

/**
 * 界面字体预设：id → CSS font-family。西文字体在前（拉丁与数字先命中），
 * 中文按平台回退（macOS 苹方系 / Windows 雅黑系 / 开源 Noto 系），任何平台都有合理渲染。
 * 'system' 为空串 → 使用 tokens.css 的默认字体栈。
 */
export const FONT_PRESETS: Record<string, string> = {
  system: '',
  serif: "Georgia, 'Times New Roman', 'Songti SC', 'STSong', SimSun, 'Noto Serif CJK SC', serif",
  kai: "'Kaiti SC', 'STKaiti', KaiTi, 'DFKai-SB', 'Noto Serif CJK SC', serif",
  mono: "'SF Mono', ui-monospace, Menlo, Consolas, 'Cascadia Code', monospace",
}

/** 解析字体设置为可用的 CSS font-family 值 */
export function resolveFontStack(font: string): string {
  return FONT_PRESETS[font] ?? font
}

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode !== 'system') return mode
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    settings: { theme: 'system', defaultExportFormat: 'markdown', fontFamily: 'system' } as Settings,
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
      const font = this.settings.fontFamily
      if (!font || font === 'system') document.documentElement.style.removeProperty('--font')
      else document.documentElement.style.setProperty('--font', resolveFontStack(font))
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
