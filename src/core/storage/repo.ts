import type { Library, Settings, Template } from '../models'
import { DEFAULT_SETTINGS } from '../models'
import type { StorageAdapter } from './adapter'
import { createWebAdapter } from './web'

interface StoredSettings {
  settings: Settings
}

export class Repo {
  adapter: StorageAdapter
  private timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(adapter: StorageAdapter) {
    this.adapter = adapter
  }

  async readJSON<T>(rel: string, fallback: T): Promise<T> {
    const raw = await this.adapter.readText(rel)
    if (raw === null) return fallback
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }

  /** 变更防抖落盘：同一文件在 400ms 内的多次写入合并为一次 */
  saveJSON(rel: string, data: unknown): void {
    const existing = this.timers.get(rel)
    if (existing) clearTimeout(existing)
    this.timers.set(
      rel,
      setTimeout(() => {
        this.timers.delete(rel)
        void this.adapter.writeText(rel, JSON.stringify(data, null, 2))
      }, 400),
    )
  }

  async saveNow(rel: string, data: unknown): Promise<void> {
    const existing = this.timers.get(rel)
    if (existing) {
      clearTimeout(existing)
      this.timers.delete(rel)
    }
    await this.adapter.writeText(rel, JSON.stringify(data, null, 2))
  }

  remove(rel: string): Promise<void> {
    return this.adapter.remove(rel)
  }

  async loadSettings(): Promise<Settings> {
    const stored = await this.readJSON<StoredSettings>('settings.json', { settings: DEFAULT_SETTINGS })
    return { ...DEFAULT_SETTINGS, ...stored.settings }
  }

  async loadUserTemplates(): Promise<Template[]> {
    const names = await this.adapter.listFiles('templates')
    const templates: Template[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const t = await this.readJSON<Template | null>(`templates/${name}`, null)
      if (t && t.id && Array.isArray(t.fields)) templates.push(t)
    }
    return templates
  }

  async loadLibraries(): Promise<Library[]> {
    const names = await this.adapter.listFiles('libraries')
    const libraries: Library[] = []
    for (const name of names) {
      if (!name.endsWith('.json')) continue
      const lib = await this.readJSON<Library | null>(`libraries/${name}`, null)
      if (lib && lib.id && Array.isArray(lib.entries)) libraries.push(lib)
    }
    return libraries
  }
}

let _repo: Repo | null = null

/** 存储层在应用挂载前由 initRepo() 初始化，之后各处通过 repo() 访问 */
export function repo(): Repo {
  if (!_repo) throw new Error('存储层尚未初始化')
  return _repo
}

export async function getAdapter(): Promise<StorageAdapter> {
  if (typeof window === 'undefined') return createWebAdapter()
  if ('__TAURI_INTERNALS__' in window) {
    const { createTauriAdapter } = await import('./tauri')
    return createTauriAdapter()
  }
  const cap = (window as unknown as Record<string, unknown>).Capacitor as { isNativePlatform?: () => boolean } | undefined
  if (cap?.isNativePlatform?.()) {
    const { createCapacitorAdapter } = await import('./capacitor')
    return createCapacitorAdapter()
  }
  return createWebAdapter()
}

export async function initRepo(): Promise<void> {
  _repo = new Repo(await getAdapter())
}
