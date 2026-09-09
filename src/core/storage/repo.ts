import type { Library, Settings, Template } from '../models'
import { DEFAULT_SETTINGS } from '../models'
import type { StorageAdapter } from './adapter'
import { createWebAdapter } from './web'

interface StoredSettings {
  settings: Settings
}

/** 外部库注册表：记录独立存放的库文件位置（库文件自身也在 dataRoot 内作备份索引） */
interface LibraryIndex {
  external: { id: string; storagePath: string; fileName: string }[]
}

const EMPTY_INDEX: LibraryIndex = { external: [] }

function libraryFile(id: string): string {
  return `libraries/${id}.json`
}

export function externalLibraryPath(lib: Pick<Library, 'storagePath' | 'fileName'>): string {
  return `${lib.storagePath}/${lib.fileName}`
}

export function isExternalLibrary(lib: Pick<Library, 'storagePath' | 'fileName'>): boolean {
  return Boolean(lib.storagePath && lib.fileName)
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

  /* ---------- 库：内部（数据文件夹）+ 外部（任意位置） ---------- */

  private async loadLibraryIndex(): Promise<LibraryIndex> {
    const idx = await this.readJSON<LibraryIndex>('libraries/index.json', EMPTY_INDEX)
    return Array.isArray(idx.external) ? idx : EMPTY_INDEX
  }

  private async saveLibraryIndex(index: LibraryIndex): Promise<void> {
    await this.saveNow('libraries/index.json', index)
  }

  /** 更新 / 注销一条外部库索引记录 */
  async registerExternalLibrary(lib: Library): Promise<void> {
    const idx = await this.loadLibraryIndex()
    const keep = isExternalLibrary(lib)
    idx.external = idx.external.filter((e) => e.id !== lib.id)
    if (keep) idx.external.push({ id: lib.id, storagePath: lib.storagePath!, fileName: lib.fileName! })
    await this.saveLibraryIndex(idx)
  }

  async loadLibraries(): Promise<Library[]> {
    const names = await this.adapter.listFiles('libraries')
    const libraries: Library[] = []
    for (const name of names) {
      if (!name.endsWith('.json') || name === 'index.json') continue
      const lib = await this.readJSON<Library | null>(`libraries/${name}`, null)
      if (lib && lib.id && Array.isArray(lib.entries)) libraries.push(lib)
    }
    // 独立存放在其他位置的库：文件读不到（盘符未挂载等）时静默跳过
    for (const rec of (await this.loadLibraryIndex()).external) {
      if (libraries.some((l) => l.id === rec.id)) continue
      if (!this.adapter.readAbs) continue
      const raw = await this.adapter.readAbs(`${rec.storagePath}/${rec.fileName}`)
      if (raw === null) continue
      try {
        const lib = JSON.parse(raw) as Library
        if (lib.id && Array.isArray(lib.entries)) {
          lib.storagePath = rec.storagePath
          lib.fileName = rec.fileName
          libraries.push(lib)
        }
      } catch {
        /* 跳过损坏的外部库文件 */
      }
    }
    return libraries
  }

  /** 依据库的存放位置把 JSON 写到对应文件（内部相对路径或外部绝对路径） */
  async saveLibrary(lib: Library): Promise<void> {
    const data = JSON.stringify(lib, null, 2)
    if (isExternalLibrary(lib)) {
      await this.adapter.writeAbs!(externalLibraryPath(lib), data)
      await this.registerExternalLibrary(lib)
    } else {
      await this.saveNow(libraryFile(lib.id), lib)
    }
  }

  /** 删除库文件（外部库同时清理索引；内部库移除 JSON 文件） */
  async removeLibrary(lib: Library): Promise<void> {
    if (isExternalLibrary(lib)) {
      await this.adapter.removeAbs!(externalLibraryPath(lib))
      await this.registerExternalLibrary({ ...lib, storagePath: null, fileName: null })
    } else {
      await this.remove(libraryFile(lib.id))
    }
  }

  /**
   * 把库文件从旧位置搬到新位置（返回新库对象；失败时抛错且不破坏旧文件）。
   * newDir 为 null 表示搬回数据文件夹内部。
   */
  async moveLibrary(lib: Library, newDir: string | null, newFileName: string): Promise<Library> {
    const data = JSON.stringify(lib, null, 2)
    if (isExternalLibrary(lib)) {
      const oldPath = externalLibraryPath(lib)
      if (newDir) {
        const newPath = `${newDir}/${newFileName}`
        await this.adapter.writeAbs!(newPath, data)
        await this.adapter.removeAbs!(oldPath)
      } else {
        await this.saveNow(libraryFile(lib.id), lib)
        await this.adapter.removeAbs!(oldPath)
      }
    } else if (newDir) {
      await this.adapter.writeAbs!(`${newDir}/${newFileName}`, data)
      await this.remove(libraryFile(lib.id))
    }
    const moved: Library = {
      ...lib,
      storagePath: newDir,
      fileName: newDir ? newFileName : null,
    }
    await this.registerExternalLibrary(moved)
    return moved
  }

  /* ---------- 数据根目录（OOBE / 设置页） ---------- */

  /** 首次启动判定与默认位置（仅桌面端有实现） */
  needsOnboarding(): Promise<boolean> {
    return this.adapter.needsOnboarding?.() ?? Promise.resolve(false)
  }

  describeDefaultRoot(): Promise<string> {
    return this.adapter.describeDefaultRoot?.() ?? Promise.resolve('')
  }

  setDataRoot(path: string | null): Promise<void> {
    return this.adapter.setDataRoot!(path)
  }

  canWriteAbs(path: string): Promise<boolean> {
    return this.adapter.canWriteAbs?.(path) ?? Promise.resolve(false)
  }

  /**
   * 把当前数据根里的所有数据（设置、模板、内部库、索引）复制到 newDir，
   * 然后切换数据根。外部库不在此列（本就独立存放）。
   */
  async copyDataTo(newDir: string): Promise<void> {
    const files: string[] = ['settings.json']
    for (const dir of ['templates', 'libraries']) {
      for (const name of await this.adapter.listFiles(dir)) {
        files.push(`${dir}/${name}`)
      }
    }
    for (const rel of files) {
      const raw = await this.adapter.readText(rel)
      if (raw === null) continue
      await this.adapter.writeAbs!(`${newDir}/${rel}`, raw)
    }
    await this.setDataRoot(newDir)
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
