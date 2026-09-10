import type { Library, Settings, Template } from '../models'
import { DEFAULT_SETTINGS } from '../models'
import type { StorageAdapter } from './adapter'
import { createWebAdapter } from './web'

interface StoredSettings {
  settings: Settings
}

/** 外部库注册表：记录独立存放的库文件夹位置（库文件自身也在 dataRoot 内作备份索引） */
interface LibraryIndex {
  external: { id: string; storagePath: string; fileName: string }[]
}

const EMPTY_INDEX: LibraryIndex = { external: [] }

/** 0.4.0 起库 JSON 的固定名（库是文件夹：<dir>/library.json + files/） */
export const LIBRARY_MANIFEST = 'library.json'

/** 内部库的相对目录（库文件夹） */
export function libraryDir(id: string): string {
  return `libraries/${id}`
}

function libraryFile(id: string): string {
  return `${libraryDir(id)}/${LIBRARY_MANIFEST}`
}

/** 外部库的文件夹绝对路径（fileName 是文件夹名） */
export function externalLibraryDir(lib: Pick<Library, 'storagePath' | 'fileName'>): string {
  return `${lib.storagePath}/${lib.fileName}`
}

export function externalLibraryPath(lib: Pick<Library, 'storagePath' | 'fileName'>): string {
  return `${externalLibraryDir(lib)}/${LIBRARY_MANIFEST}`
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

  /* ---------- 库：内部（数据文件夹）+ 外部（任意位置）。0.4.0 起库是文件夹 ---------- */

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

  /**
   * 旧版（≤0.3）单文件库自动迁移为文件夹结构：
   * - 内部：libraries/<id>.json → libraries/<id>/library.json（files/ 留空）；
   * - 外部：<dir>/<name>.json → <dir>/<name>/library.json。
   * 迁移在每次加载时幂等执行，失败静默跳过（旧文件保留，下次再试）。
   */
  private async migrateSingleFileLibraries(): Promise<void> {
    try {
      for (const name of await this.adapter.listFiles('libraries')) {
        if (!name.endsWith('.json') || name === 'index.json') continue
        const raw = await this.adapter.readText(`libraries/${name}`)
        if (raw === null) continue
        const lib = JSON.parse(raw) as Library
        if (!lib.id) continue
        await this.adapter.writeText(libraryFile(lib.id), raw)
        await this.adapter.remove(`libraries/${name}`)
      }
    } catch {
      /* 内部迁移失败不阻塞加载 */
    }
    // 外部单文件库：fileName 以 .json 结尾的旧记录
    try {
      if (!this.adapter.readAbs) return
      const idx = await this.loadLibraryIndex()
      let dirty = false
      for (const rec of idx.external) {
        if (!rec.fileName.endsWith('.json')) continue
        const oldPath = `${rec.storagePath}/${rec.fileName}`
        const raw = await this.adapter.readAbs(oldPath)
        if (raw === null) continue
        const lib = JSON.parse(raw) as Library
        if (!lib.id) continue
        const folderName = rec.fileName.replace(/\.json$/i, '')
        const dir = `${rec.storagePath}/${folderName}`
        await this.adapter.writeAbs?.(`${dir}/${LIBRARY_MANIFEST}`, raw)
        await this.adapter.removeAbs?.(oldPath)
        rec.fileName = folderName
        dirty = true
      }
      if (dirty) await this.saveLibraryIndex(idx)
    } catch {
      /* 外部迁移失败不阻塞加载 */
    }
  }

  async loadLibraries(): Promise<Library[]> {
    await this.migrateSingleFileLibraries()
    const libraries: Library[] = []
    // 内部库：libraries/<id>/library.json
    for (const id of await this.adapter.listSubdirs?.('libraries') ?? []) {
      const lib = await this.readJSON<Library | null>(`${libraryDir(id)}/${LIBRARY_MANIFEST}`, null)
      if (lib && lib.id && Array.isArray(lib.entries)) {
        lib.storagePath = null
        lib.fileName = null
        libraries.push(lib)
      }
    }
    // 独立存放在其他位置的库：文件夹读不到（盘符未挂载等）时静默跳过
    for (const rec of (await this.loadLibraryIndex()).external) {
      if (libraries.some((l) => l.id === rec.id)) continue
      if (!this.adapter.readAbs) continue
      const raw = await this.adapter.readAbs(externalLibraryPath({ storagePath: rec.storagePath, fileName: rec.fileName }))
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

  /** 依据库的存放位置把 JSON 写到对应文件夹（内部相对路径或外部绝对路径） */
  async saveLibrary(lib: Library): Promise<void> {
    if (isExternalLibrary(lib)) {
      await this.adapter.writeAbs!(externalLibraryPath(lib), JSON.stringify(lib, null, 2))
      await this.registerExternalLibrary(lib)
    } else {
      await this.saveNow(libraryFile(lib.id), lib)
    }
  }

  /** 删除库（整个库文件夹，含存档的源文件） */
  async removeLibrary(lib: Library): Promise<void> {
    if (isExternalLibrary(lib)) {
      await this.adapter.removeDir?.(externalLibraryDir(lib))
      await this.registerExternalLibrary({ ...lib, storagePath: null, fileName: null })
    } else {
      await this.adapter.removeTree?.(libraryDir(lib.id))
    }
  }

  /**
   * 把库文件夹整体搬到新位置（返回新库对象；失败时抛错且不破坏旧文件夹）。
   * newDir 为 null 表示搬回数据文件夹内部。
   */
  async moveLibrary(lib: Library, newDir: string | null, newFolderName: string): Promise<Library> {
    if (isExternalLibrary(lib)) {
      const oldDir = externalLibraryDir(lib)
      if (newDir) {
        const newLoc = `${newDir}/${newFolderName}`
        await this.adapter.copyDir!(oldDir, newLoc)
        await this.adapter.removeDir!(oldDir)
      } else {
        const destAbs = await this.adapter.absOf!(libraryDir(lib.id))
        await this.adapter.ensureDirAbs!(destAbs)
        await this.adapter.copyDir!(oldDir, destAbs)
        await this.adapter.removeDir!(oldDir)
      }
    } else if (newDir) {
      const srcAbs = await this.adapter.absOf!(libraryDir(lib.id))
      const newLoc = `${newDir}/${newFolderName}`
      await this.adapter.ensureDirAbs!(newLoc)
      await this.adapter.copyDir!(srcAbs, newLoc)
      await this.adapter.removeTree!(libraryDir(lib.id))
    }
    const moved: Library = {
      ...lib,
      storagePath: newDir,
      fileName: newDir ? newFolderName : null,
    }
    await this.registerExternalLibrary(moved)
    await this.saveLibrary(moved)
    return moved
  }

  /* ---------- 库内附件文件（files/） ---------- */

  /** 库文件夹里 files/ 的目标位置：内部返回相对路径，外部返回绝对路径 */
  attachmentTarget(lib: Library, storedAs: string): { rel?: string; abs?: string } {
    if (isExternalLibrary(lib)) return { abs: `${externalLibraryDir(lib)}/files/${storedAs}` }
    return { rel: `${libraryDir(lib.id)}/files/${storedAs}` }
  }

  /** 确保库的 files/ 目录存在（外部库用） */
  async ensureAttachmentDir(lib: Library): Promise<void> {
    if (!isExternalLibrary(lib)) return
    await this.adapter.ensureDirAbs?.(`${externalLibraryDir(lib)}/files`)
  }

  /**
   * 把外部文件复制进库文件夹（桌面端）。返回是否成功。
   */
  async copyFileIntoLibrary(lib: Library, srcAbs: string, storedAs: string): Promise<boolean> {
    const t = this.attachmentTarget(lib, storedAs)
    try {
      if (t.rel) {
        await this.adapter.copyFileIn?.(srcAbs, t.rel)
        return true
      }
      if (t.abs) {
        await this.adapter.ensureDirAbs?.(`${externalLibraryDir(lib)}/files`)
        const fsmod = await import('@tauri-apps/plugin-fs')
        await fsmod.copyFile(srcAbs, t.abs)
        return true
      }
    } catch {
      /* 复制失败按不支持处理 */
    }
    return false
  }

  /**
   * 把内存中的字节写入库文件夹（安卓导入）。返回是否成功。
   */
  async writeLibraryBinary(lib: Library, storedAs: string, bytes: Uint8Array): Promise<boolean> {
    const t = this.attachmentTarget(lib, storedAs)
    if (t.rel) return (await this.adapter.writeBinary?.(t.rel, bytes)) ?? false
    if (t.abs) {
      try {
        await this.adapter.ensureDirAbs?.(`${externalLibraryDir(lib)}/files`)
        const fsmod = await import('@tauri-apps/plugin-fs')
        await fsmod.writeFile(t.abs, bytes)
        return true
      } catch {
        return false
      }
    }
    return false
  }

  /** 读取库文件夹 files/ 内的二进制（Excel 图片等，条目详情展示用） */
  async readLibraryBinary(lib: Library, storedAs: string): Promise<Uint8Array | null> {
    const t = this.attachmentTarget(lib, storedAs)
    try {
      if (t.rel) {
        if (this.adapter.readBinary) return await this.adapter.readBinary(t.rel)
        if (this.adapter.absOf && this.adapter.readBytesAbs) return await this.adapter.readBytesAbs(await this.adapter.absOf(t.rel))
        return null
      }
      if (t.abs && this.adapter.readBytesAbs) return await this.adapter.readBytesAbs(t.abs)
    } catch {
      return null
    }
    return null
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
   * 把当前数据根里的所有数据（设置、模板、内部库文件夹、索引）整体复制到 newDir，
   * 然后切换数据根。外部库不在此列（本就独立存放）。
   */
  async copyDataTo(newDir: string): Promise<void> {
    if (this.adapter.copyDir && this.adapter.absOf) {
      const src = await this.adapter.absOf('')
      await this.adapter.ensureDirAbs?.(newDir)
      await this.adapter.copyDir(src, newDir)
    } else {
      // 非 Tauri 环境兜底：逐文件复制文本（不含二进制附件）
      const files: string[] = ['settings.json']
      for (const dir of ['templates', 'libraries']) {
        for (const rel of await this.adapter.listTree?.(dir) ?? []) files.push(`${dir}/${rel}`)
      }
      for (const rel of files) {
        const raw = await this.adapter.readText(rel)
        if (raw === null) continue
        await this.adapter.writeAbs!(`${newDir}/${rel}`, raw)
      }
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
