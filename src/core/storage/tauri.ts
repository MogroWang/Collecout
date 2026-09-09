import type { StorageAdapter } from './adapter'

/** 数据文件夹名（0.2.0 起使用，与 0.1.0 的 collecout 区分开便于迁移） */
export const DATA_DIR = 'collecout-data'
/** 0.1.0 在 AppData 下的旧数据目录 */
const LEGACY_DIR = 'collecout'

type BaseDir = 'appdata' | 'exe' | 'home'
type FsPlugin = typeof import('@tauri-apps/plugin-fs')

function osName(): 'windows' | 'macos' | 'linux' {
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'windows'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos'
  return 'linux'
}

let rootPromise: Promise<{ base: BaseDir }> | null = null

/**
 * 数据根目录：
 * - Windows：exe 所在目录（绿色便携，数据跟着程序走）；
 * - macOS：家目录（exe 在 .app 包内，写入会破坏应用签名，不能采用）；
 * - Linux：先试 exe 目录（AppImage 等只读场景会失败），失败落回家目录；
 * - 都不可写时退回系统应用数据目录。
 */
function resolveRoot(): Promise<{ base: BaseDir }> {
  if (!rootPromise) rootPromise = doResolve()
  return rootPromise
}

async function doResolve(): Promise<{ base: BaseDir }> {
  const os = osName()
  const order: BaseDir[] =
    os === 'windows' ? ['exe', 'appdata'] : os === 'macos' ? ['home', 'appdata'] : ['exe', 'home', 'appdata']
  for (const base of order) {
    if (await writable(base)) return { base }
  }
  return { base: 'appdata' }
}

async function writable(base: BaseDir): Promise<boolean> {
  try {
    const fs = await import('@tauri-apps/plugin-fs')
    const bd = baseDirOf(fs, base)
    await fs.mkdir(DATA_DIR, { baseDir: bd, recursive: true })
    await fs.writeTextFile(`${DATA_DIR}/.probe`, 'ok', { baseDir: bd })
    await fs.remove(`${DATA_DIR}/.probe`, { baseDir: bd }).catch(() => undefined)
    return true
  } catch {
    return false
  }
}

function baseDirOf(fs: FsPlugin, base: BaseDir): (typeof fs.BaseDirectory)[keyof typeof fs.BaseDirectory] {
  switch (base) {
    case 'exe':
      return fs.BaseDirectory.Executable
    case 'home':
      return fs.BaseDirectory.Home
    default:
      return fs.BaseDirectory.AppData
  }
}

/** 把 0.1.0 存在 AppData/collecout 的数据迁移到新根目录（仅当新根为空时） */
async function migrateLegacy(rootBase: BaseDir): Promise<void> {
  try {
    const fs = await import('@tauri-apps/plugin-fs')
    const legacyLibraries = await fs.exists(`${LEGACY_DIR}/libraries`, { baseDir: fs.BaseDirectory.AppData })
    if (!legacyLibraries) return
    const alreadyMigrated = await fs.exists(`${DATA_DIR}/libraries`, { baseDir: baseDirOf(fs, rootBase) })
    if (alreadyMigrated) return
    await copyLegacyDir(fs, rootBase, LEGACY_DIR, DATA_DIR)
  } catch {
    /* 迁移失败不阻塞启动，用户数据仍在原处 */
  }
}

async function copyLegacyDir(fs: FsPlugin, rootBase: BaseDir, rel: string, targetRel: string): Promise<void> {
  const entries = await fs.readDir(rel, { baseDir: fs.BaseDirectory.AppData })
  for (const e of entries) {
    const from = `${rel}/${e.name}`
    const to = `${targetRel}/${e.name}`
    if (e.isDirectory) {
      await fs.mkdir(to, { baseDir: baseDirOf(fs, rootBase), recursive: true })
      await copyLegacyDir(fs, rootBase, from, to)
    } else if (e.isFile) {
      const content = await fs.readTextFile(from, { baseDir: fs.BaseDirectory.AppData })
      await fs.writeTextFile(to, content, { baseDir: baseDirOf(fs, rootBase) })
    }
  }
}

/**
 * Tauri 桌面端存储：数据放在用户可见的本地目录（见 resolveRoot），
 * 并自动把 0.1.0 遗留在 AppData/collecout 的数据迁移过来。
 */
export function createTauriAdapter(): StorageAdapter {
  const ensuredDirs = new Set<string>()
  let fsMod: FsPlugin | null = null
  let rootBase: BaseDir = 'appdata'

  const ready = (async () => {
    const [root, fs] = await Promise.all([resolveRoot(), import('@tauri-apps/plugin-fs')])
    fsMod = fs
    rootBase = root.base
    await migrateLegacy(rootBase)
  })()

  const baseDir = () => baseDirOf(fsMod!, rootBase)

  const ensureDir = async (path: string) => {
    const dir = path.split('/').slice(0, -1).join('/')
    if (!dir || ensuredDirs.has(dir)) return
    await fsMod!.mkdir(`${DATA_DIR}/${dir}`, { baseDir: baseDir(), recursive: true })
    ensuredDirs.add(dir)
  }

  const describeRoot = async (): Promise<string> => {
    await ready
    try {
      const path = await import('@tauri-apps/api/path')
      const dir =
        rootBase === 'exe'
          ? await path.executableDir()
          : rootBase === 'home'
            ? await path.homeDir()
            : await path.appDataDir()
      return `${dir.replace(/[\\/]+$/, '')}/${DATA_DIR}`
    } catch {
      return DATA_DIR
    }
  }

  return {
    async readText(path) {
      await ready
      try {
        return await fsMod!.readTextFile(`${DATA_DIR}/${path}`, { baseDir: baseDir() })
      } catch {
        return null
      }
    },
    async writeText(path, data) {
      await ready
      await ensureDir(path)
      await fsMod!.writeTextFile(`${DATA_DIR}/${path}`, data, { baseDir: baseDir() })
    },
    async remove(path) {
      await ready
      try {
        await fsMod!.remove(`${DATA_DIR}/${path}`, { baseDir: baseDir() })
      } catch {
        /* 文件不存在视为成功 */
      }
    },
    async listFiles(dir) {
      await ready
      try {
        const entries = await fsMod!.readDir(`${DATA_DIR}/${dir}`, { baseDir: baseDir() })
        return entries.filter((e) => e.isFile).map((e) => e.name)
      } catch {
        return []
      }
    },
    async exists(path) {
      await ready
      try {
        return await fsMod!.exists(`${DATA_DIR}/${path}`, { baseDir: baseDir() })
      } catch {
        return false
      }
    },
    describeRoot,
  }
}
