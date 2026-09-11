import type { StorageAdapter } from './adapter'

/** 数据文件夹名（0.2.0 起使用，与 0.1.0 的 collecout 区分开便于迁移） */
export const DATA_DIR = 'collecout-data'
/** 指针文件：记录用户自定义的数据根目录，保存在默认数据文件夹内 */
const POINTER_FILE = 'data-root.json'

type FsPlugin = typeof import('@tauri-apps/plugin-fs')

function osName(): 'windows' | 'macos' | 'linux' {
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'windows'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos'
  return 'linux'
}

/** 去掉路径尾部分隔符并统一为系统风格 */
function trimPath(p: string): string {
  return p.replace(/[\\/]+$/, '')
}

/** 某个 base 目录的可读绝对路径（0.1.0 遗留迁移 / 兜底探测用） */
async function describeBaseDir(base: 'appdata' | 'home'): Promise<string> {
  const path = await import('@tauri-apps/api/path')
  const dir = base === 'home' ? await path.homeDir() : await path.appDataDir()
  return trimPath(dir)
}

/** 探测一个绝对路径目录是否可写（在其中创建并删除探针文件） */
async function writableAbsDir(fs: FsPlugin, abs: string): Promise<boolean> {
  try {
    const probe = `${trimPath(abs)}/.collecout-probe`
    await fs.writeTextFile(probe, 'ok')
    await fs.remove(probe).catch(() => undefined)
    return true
  } catch {
    return false
  }
}

/** 目录是否像一个萃序数据文件夹（含库 / 设置 / 模板任一特征） */
async function looksLikeDataDir(fs: FsPlugin, abs: string): Promise<boolean> {
  try {
    return (
      (await fs.exists(`${abs}/libraries`)) ||
      (await fs.exists(`${abs}/settings.json`)) ||
      (await fs.exists(`${abs}/templates`))
    )
  } catch {
    return false
  }
}

/** 探测常见位置的现有数据文件夹（OOBE「读取现有数据」用），返回绝对路径列表 */
async function probeExistingRoots(fs: FsPlugin, defRootAbs: string): Promise<string[]> {
  const candidates = [
    `${await describeBaseDir('appdata')}/${DATA_DIR}`,
    `${await describeBaseDir('appdata')}/collecout`,
    `${await describeBaseDir('home')}/${DATA_DIR}`,
  ]
  const out: string[] = []
  for (const abs of candidates.map(trimPath)) {
    if (abs === defRootAbs || out.includes(abs)) continue
    if (await looksLikeDataDir(fs, abs)) out.push(abs)
  }
  return out
}

/** 兜底默认根：Rust 命令不可用时按平台解析（极少走到） */
async function fallbackDefaultRoot(): Promise<string> {
  const os = osName()
  const base = os === 'windows' ? 'appdata' : 'home'
  return `${await describeBaseDir(base)}/${DATA_DIR}`
}

/**
 * Tauri 桌面端存储：数据根一律使用绝对路径。
 * 默认根由 Rust 命令 resolve_default_root 用 std::fs 权威解析（exe 目录便携优先 →
 * 家目录 → AppData），前端拿路径后登记进 fs 插件运行时 scope 再读写——此前用 fs 插件
 * 按 baseDir 探测，Windows 上 exe 目录的 scope/路径解析不可靠，探测失败又被静默吞掉，
 * 默认根总是退回 AppData；改为 Rust 解析后结果唯一确定。
 * 指针文件记在默认数据文件夹内，自定义位置失效时下次启动自动回退默认。
 */
export function createTauriAdapter(): StorageAdapter {
  const ensuredDirs = new Set<string>()
  let fsMod: FsPlugin | null = null
  /** 默认数据根（恒定，指针文件所在处），绝对路径 */
  let defRootAbs: string | null = null
  /** 当前生效数据根，绝对路径（默认根或用户自定义） */
  let rootAbs: string | null = null

  const ready = (async () => {
    const fs = await import('@tauri-apps/plugin-fs')
    fsMod = fs
    const { extendFsScope } = await import('../../lib/desktop')
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      defRootAbs = trimPath(await invoke<string>('resolve_default_root'))
    } catch {
      defRootAbs = await fallbackDefaultRoot()
    }
    // 默认根（可能在 exe 目录下）登记进 fs 插件运行时 scope，绝对路径读写才被放行
    await extendFsScope(defRootAbs, true)
    const custom = await readPointer(fs)
    rootAbs = custom && (await writableAbsDir(fs, custom)) ? custom : defRootAbs
    if (rootAbs !== defRootAbs) await extendFsScope(rootAbs, true)
    await migrateLegacy(fs)
  })()

  const fsReady = async (): Promise<FsPlugin> => {
    await ready
    return fsMod!
  }

  const rootOf = async (): Promise<string> => {
    await ready
    return rootAbs!
  }

  const targetOf = async (rel: string): Promise<string> => {
    return `${await rootOf()}/${rel}`
  }

  const ensureDir = async (path: string) => {
    const dir = path.split('/').slice(0, -1).join('/')
    if (!dir || ensuredDirs.has(dir)) return
    const fs = await fsReady()
    await fs.mkdir(await targetOf(dir), { recursive: true })
    ensuredDirs.add(dir)
  }

  /** 读取指针文件（在默认数据文件夹内），拿到用户自定义的数据根 */
  async function readPointer(fs: FsPlugin): Promise<string | null> {
    try {
      const raw = await fs.readTextFile(`${defRootAbs}/${POINTER_FILE}`)
      const parsed = JSON.parse(raw) as { dataRoot?: unknown }
      return typeof parsed.dataRoot === 'string' && parsed.dataRoot.trim() !== '' ? parsed.dataRoot : null
    } catch {
      return null
    }
  }

  /** 把 0.1.0 存在 AppData/collecout 的数据迁移到当前数据根（仅当当前根为空时） */
  async function migrateLegacy(fs: FsPlugin): Promise<void> {
    try {
      const legacyBase = await describeBaseDir('appdata')
      const legacyLibraries = await fs.exists(`${legacyBase}/collecout/libraries`)
      if (!legacyLibraries) return
      if (await fs.exists(`${rootAbs!}/libraries`)) return
      await copyLegacyDir(fs, `${legacyBase}/collecout`, rootAbs!)
    } catch {
      /* 迁移失败不阻塞启动，用户数据仍在原处 */
    }
  }

  async function copyLegacyDir(fs: FsPlugin, fromAbs: string, toAbs: string): Promise<void> {
    const entries = await fs.readDir(fromAbs)
    await fs.mkdir(toAbs, { recursive: true }).catch(() => undefined)
    for (const e of entries) {
      const from = `${fromAbs}/${e.name}`
      const to = `${toAbs}/${e.name}`
      if (e.isDirectory) {
        await copyLegacyDir(fs, from, to)
      } else if (e.isFile) {
        await fs.writeTextFile(to, await fs.readTextFile(from))
      }
    }
  }

  return {
    async readText(path) {
      const fs = await fsReady()
      try {
        return await fs.readTextFile(await targetOf(path))
      } catch {
        return null
      }
    },
    async writeText(path, data) {
      const fs = await fsReady()
      await ensureDir(path)
      await fs.writeTextFile(await targetOf(path), data)
    },
    async remove(path) {
      const fs = await fsReady()
      try {
        await fs.remove(await targetOf(path))
      } catch {
        /* 文件不存在视为成功 */
      }
    },
    async listFiles(dir) {
      const fs = await fsReady()
      try {
        const entries = await fs.readDir(await targetOf(dir))
        return entries.filter((e) => e.isFile).map((e) => e.name)
      } catch {
        return []
      }
    },
    async exists(path) {
      const fs = await fsReady()
      try {
        return await fs.exists(await targetOf(path))
      } catch {
        return false
      }
    },
    async describeRoot() {
      return rootOf()
    },

    /* ---------- 库文件夹结构与跨位置能力 ---------- */

    async listSubdirs(dir) {
      const fs = await fsReady()
      try {
        const entries = await fs.readDir(await targetOf(dir))
        return entries.filter((e) => e.isDirectory).map((e) => e.name)
      } catch {
        return []
      }
    },
    async listTree(dir) {
      const fs = await fsReady()
      const base = await targetOf(dir)
      const out: string[] = []
      const walk = async (rel: string) => {
        let entries
        try {
          entries = await fs.readDir(rel === '' ? base : `${base}/${rel}`)
        } catch {
          return
        }
        for (const e of entries) {
          if (e.isDirectory) await walk(rel === '' ? e.name : `${rel}/${e.name}`)
          else out.push(rel === '' ? e.name : `${rel}/${e.name}`)
        }
      }
      await walk('')
      return out
    },
    async removeTree(rel) {
      const fs = await fsReady()
      try {
        await fs.remove(await targetOf(rel), { recursive: true })
      } catch {
        /* 目录不存在视为成功 */
      }
      ensuredDirs.clear()
    },
    async writeBinary(rel, bytes) {
      const fs = await fsReady()
      await ensureDir(rel)
      await fs.writeFile(await targetOf(rel), bytes)
      return true
    },
    async readBinary(rel) {
      const fs = await fsReady()
      try {
        return await fs.readFile(await targetOf(rel))
      } catch {
        return null
      }
    },
    async absOf(rel) {
      return targetOf(rel)
    },
    async readBytesAbs(abs) {
      const fs = await fsReady()
      try {
        return await fs.readFile(abs)
      } catch {
        return null
      }
    },
    async copyDir(srcAbs, destAbs) {
      const fs = await fsReady()
      await fs.mkdir(destAbs, { recursive: true }).catch(() => undefined)
      const entries = await fs.readDir(srcAbs)
      for (const e of entries) {
        const from = `${srcAbs}/${e.name}`
        const to = `${destAbs}/${e.name}`
        if (e.isDirectory) await this.copyDir!(from, to)
        else await fs.copyFile(from, to)
      }
    },
    async removeDir(abs) {
      const fs = await fsReady()
      try {
        await fs.remove(abs, { recursive: true })
      } catch {
        /* 目录不存在视为成功 */
      }
    },
    async ensureDirAbs(abs) {
      const fs = await fsReady()
      await fs.mkdir(abs, { recursive: true }).catch(() => undefined)
    },
    async listDirAbs(abs) {
      const fs = await fsReady()
      try {
        const entries = await fs.readDir(abs)
        return entries.map((e) => e.name)
      } catch {
        return []
      }
    },
    async copyFileIn(srcAbs, destRel) {
      const fs = await fsReady()
      await ensureDir(destRel)
      await fs.copyFile(srcAbs, await targetOf(destRel))
    },

    /* ---------- 桌面端专属能力 ---------- */

    async readAbs(path) {
      const fs = await fsReady()
      try {
        return await fs.readTextFile(path)
      } catch {
        return null
      }
    },
    async writeAbs(path, data) {
      const fs = await fsReady()
      const dir = path.replace(/[\\/][^\\/]+$/, '')
      if (dir && dir !== path) await fs.mkdir(dir, { recursive: true }).catch(() => undefined)
      await fs.writeTextFile(path, data)
    },
    async removeAbs(path) {
      const fs = await fsReady()
      try {
        await fs.remove(path)
      } catch {
        /* 文件不存在视为成功 */
      }
    },
    async existsAbs(path) {
      const fs = await fsReady()
      try {
        return await fs.exists(path)
      } catch {
        return false
      }
    },
    async canWriteAbs(path) {
      const fs = await fsReady()
      return writableAbsDir(fs, path)
    },
    async needsOnboarding() {
      const fs = await fsReady()
      try {
        // 已写过数据位置指针 → 完成过 OOBE（含自定义位置的用户）；
        // 老版本没有指针，但默认数据文件夹里已有 libraries
        if (await fs.exists(`${defRootAbs}/${POINTER_FILE}`)) return false
        return !(await fs.exists(`${defRootAbs}/libraries`))
      } catch {
        return false
      }
    },
    async probeExistingRoots() {
      const fs = await fsReady()
      return probeExistingRoots(fs, defRootAbs!)
    },
    async looksLikeDataDir(abs) {
      const fs = await fsReady()
      return looksLikeDataDir(fs, abs)
    },
    async describeDefaultRoot() {
      await ready
      return defRootAbs!
    },
    async setDataRoot(path) {
      const fs = await fsReady()
      const { extendFsScope } = await import('../../lib/desktop')
      if (path) {
        if (!(await writableAbsDir(fs, path))) throw new Error('所选文件夹不可写')
        await fs.mkdir(path, { recursive: true }).catch(() => undefined)
        rootAbs = trimPath(path)
      } else {
        rootAbs = defRootAbs!
      }
      ensuredDirs.clear()
      // 新根同样登记进运行时 scope（OOBE 的默认根已在 ready 里登记过）
      await extendFsScope(rootAbs, true)
      // 指针写入默认数据文件夹：即使之后自定义位置失效，下次启动也能从默认根读到指针并回退
      await fs.mkdir(defRootAbs!, { recursive: true }).catch(() => undefined)
      await fs.writeTextFile(`${defRootAbs}/${POINTER_FILE}`, JSON.stringify({ dataRoot: rootAbs === defRootAbs ? null : rootAbs }, null, 2))
    },
  }
}
