import type { StorageAdapter } from './adapter'

/** 数据文件夹名（0.2.0 起使用，与 0.1.0 的 collecout 区分开便于迁移） */
export const DATA_DIR = 'collecout-data'
/** 0.1.0 在 AppData 下的旧数据目录 */
const LEGACY_DIR = 'collecout'
/** 指针文件：记录用户自定义的数据根目录，保存在默认数据文件夹内 */
const POINTER_FILE = 'data-root.json'

type BaseDir = 'appdata' | 'exe' | 'home'
type FsPlugin = typeof import('@tauri-apps/plugin-fs')

/** 当前生效的数据根：默认按平台解析（base），或用户自定义的绝对路径（abs） */
type Root = { base: BaseDir } | { abs: string }

function osName(): 'windows' | 'macos' | 'linux' {
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'windows'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'macos'
  return 'linux'
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

/** 某个 base 目录的可读绝对路径（展示 / 探测用） */
async function describeBaseDir(base: BaseDir): Promise<string> {
  const path = await import('@tauri-apps/api/path')
  const dir =
    base === 'exe' ? await path.executableDir() : base === 'home' ? await path.homeDir() : await path.appDataDir()
  return dir.replace(/[\\/]+$/, '')
}

/**
 * 默认数据根目录：跟随软件本目录（exe 所在文件夹，绿色便携，数据跟着程序走）。
 * - macOS 的 exe 在 .app 包内，写入会破坏签名，探测失败后落回家目录；
 * - Linux 的 AppImage 挂载点只读，同理落回；
 * - 都不可写时退回系统应用数据目录。
 */
async function resolveDefaultRoot(fs: FsPlugin): Promise<BaseDir> {
  const os = osName()
  const order: BaseDir[] = os === 'windows' ? ['exe', 'appdata'] : ['exe', 'home', 'appdata']
  for (const base of order) {
    const bd = baseDirOf(fs, base)
    // 探测前记录目录是否本来就存在：失败时只清理自己新建的空壳，不动已有数据
    const existed = await fs.exists(DATA_DIR, { baseDir: bd }).catch(() => true)
    try {
      await fs.mkdir(DATA_DIR, { baseDir: bd, recursive: true })
      await fs.writeTextFile(`${DATA_DIR}/.probe`, 'ok', { baseDir: bd })
      await fs.remove(`${DATA_DIR}/.probe`, { baseDir: bd }).catch(() => undefined)
      return base
    } catch {
      // 目录写不进去（只读位置等）：删掉刚建的空壳，避免在程序目录留下无用的空文件夹
      if (!existed) await fs.remove(DATA_DIR, { baseDir: bd, recursive: true }).catch(() => undefined)
      /* 尝试下一个位置 */
    }
  }
  return 'appdata'
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

/**
 * 探测常见位置的现有数据文件夹（OOBE「读取现有数据」用）：
 * 0.2.0+ 的 AppData 兜底位置、0.1.0 的遗留目录、家目录兜底；
 * 默认根（exe 目录旁）本身有数据时不会进 OOBE，故无需列入。
 */
async function probeExistingRoots(fs: FsPlugin, defRoot: BaseDir): Promise<string[]> {
  const candidates: { base: BaseDir; dir: string }[] = [
    { base: 'appdata', dir: DATA_DIR },
    { base: 'appdata', dir: LEGACY_DIR },
    { base: 'home', dir: DATA_DIR },
  ]
  const out: string[] = []
  for (const c of candidates) {
    if (c.base === defRoot && c.dir === DATA_DIR) continue
    let abs: string
    try {
      abs = `${await describeBaseDir(c.base)}/${c.dir}`.replace(/[\\/]+$/, '')
    } catch {
      continue
    }
    if (out.includes(abs)) continue
    if (await looksLikeDataDir(fs, abs)) out.push(abs)
  }
  return out
}

/** 探测一个绝对路径目录是否可写（在其中创建并删除探针文件） */
async function writableAbsDir(fs: FsPlugin, abs: string): Promise<boolean> {
  try {
    const probe = `${abs.replace(/[\\/]+$/, '')}/.collecout-probe`
    await fs.writeTextFile(probe, 'ok')
    await fs.remove(probe).catch(() => undefined)
    return true
  } catch {
    return false
  }
}

/** 读取指针文件（在默认数据文件夹内），拿到用户自定义的数据根 */
async function readPointer(fs: FsPlugin, defBase: BaseDir): Promise<string | null> {
  try {
    const raw = await fs.readTextFile(`${DATA_DIR}/${POINTER_FILE}`, { baseDir: baseDirOf(fs, defBase) })
    const parsed = JSON.parse(raw) as { dataRoot?: unknown }
    return typeof parsed.dataRoot === 'string' && parsed.dataRoot.trim() !== '' ? parsed.dataRoot : null
  } catch {
    return null
  }
}

/** 把 0.1.0 存在 AppData/collecout 的数据迁移到当前数据根（仅当当前根为空时） */
async function migrateLegacy(fs: FsPlugin, root: Root): Promise<void> {
  try {
    const legacyLibraries = await fs.exists(`${LEGACY_DIR}/libraries`, { baseDir: fs.BaseDirectory.AppData })
    if (!legacyLibraries) return
    const target = (rel: string) => ('base' in root ? `${DATA_DIR}/${rel}` : `${root.abs}/${rel}`)
    const opts = () => ('base' in root ? { baseDir: baseDirOf(fs, root.base) } : {})
    if (await fs.exists(target('libraries'), opts())) return
    await copyLegacyDir(fs, target, opts, LEGACY_DIR, DATA_DIR)
  } catch {
    /* 迁移失败不阻塞启动，用户数据仍在原处 */
  }
}

async function copyLegacyDir(
  fs: FsPlugin,
  target: (rel: string) => string,
  opts: () => Record<string, unknown>,
  rel: string,
  targetRel: string,
): Promise<void> {
  const entries = await fs.readDir(rel, { baseDir: fs.BaseDirectory.AppData })
  for (const e of entries) {
    const from = `${rel}/${e.name}`
    const to = target(`${targetRel}/${e.name}`)
    if (e.isDirectory) {
      await fs.mkdir(to, { recursive: true, ...opts() } as Parameters<typeof fs.mkdir>[1])
      await copyLegacyDir(fs, target, opts, from, `${targetRel}/${e.name}`)
    } else if (e.isFile) {
      const content = await fs.readTextFile(from, { baseDir: fs.BaseDirectory.AppData })
      await fs.writeTextFile(to, content, opts() as Parameters<typeof fs.writeTextFile>[2])
    }
  }
}

/**
 * Tauri 桌面端存储：数据放在用户可见的本地目录（默认跟随软件，或用户在 OOBE /
 * 设置页里自定义的任意位置），并自动把 0.1.0 遗留在 AppData/collecout 的数据迁移过来。
 */
export function createTauriAdapter(): StorageAdapter {
  const ensuredDirs = new Set<string>()
  let fsMod: FsPlugin | null = null
  /** 默认根（恒定，指针文件所在处），形如 { base } */
  let defRoot: BaseDir | null = null
  let root: Root | null = null

  const ready = (async () => {
    const fs = await import('@tauri-apps/plugin-fs')
    fsMod = fs
    defRoot = await resolveDefaultRoot(fs)
    const custom = await readPointer(fs, defRoot)
    root = custom && (await writableAbsDir(fs, custom)) ? { abs: custom } : { base: defRoot }
    await migrateLegacy(fs, root)
  })()

  const fsReady = async (): Promise<FsPlugin> => {
    await ready
    return fsMod!
  }

  const rootOf = async (): Promise<Root> => {
    await ready
    return root!
  }

  /** 数据根内 rel 的完整目标（base 形式配合 baseDir 选项，abs 形式直接拼路径） */
  const targetOf = async (rel: string): Promise<{ path: string; opts: Record<string, unknown> }> => {
    const fs = await fsReady()
    const r = await rootOf()
    if ('abs' in r) return { path: `${r.abs}/${rel}`, opts: {} }
    return { path: `${DATA_DIR}/${rel}`, opts: { baseDir: baseDirOf(fs, r.base) } }
  }

  const ensureDir = async (path: string) => {
    const dir = path.split('/').slice(0, -1).join('/')
    if (!dir || ensuredDirs.has(dir)) return
    const fs = await fsReady()
    const { path: dirPath, opts } = await targetOf(dir)
    await fs.mkdir(dirPath, { recursive: true, ...opts } as Parameters<typeof fs.mkdir>[1])
    ensuredDirs.add(dir)
  }

  return {
    async readText(path) {
      const fs = await fsReady()
      const { path: p, opts } = await targetOf(path)
      try {
        return await fs.readTextFile(p, opts as Parameters<typeof fs.readTextFile>[1])
      } catch {
        return null
      }
    },
    async writeText(path, data) {
      const fs = await fsReady()
      await ensureDir(path)
      const { path: p, opts } = await targetOf(path)
      await fs.writeTextFile(p, data, opts as Parameters<typeof fs.writeTextFile>[2])
    },
    async remove(path) {
      const fs = await fsReady()
      const { path: p, opts } = await targetOf(path)
      try {
        await fs.remove(p, opts as Parameters<typeof fs.remove>[1])
      } catch {
        /* 文件不存在视为成功 */
      }
    },
    async listFiles(dir) {
      const fs = await fsReady()
      const { path: p, opts } = await targetOf(dir)
      try {
        const entries = await fs.readDir(p, opts as Parameters<typeof fs.readDir>[1])
        return entries.filter((e) => e.isFile).map((e) => e.name)
      } catch {
        return []
      }
    },
    async exists(path) {
      const fs = await fsReady()
      const { path: p, opts } = await targetOf(path)
      try {
        return await fs.exists(p, opts as Parameters<typeof fs.exists>[1])
      } catch {
        return false
      }
    },
    async describeRoot() {
      const r = await rootOf()
      try {
        if ('abs' in r) return r.abs
        return `${await describeBaseDir(r.base)}/${DATA_DIR}`
      } catch {
        return DATA_DIR
      }
    },

    /* ---------- 库文件夹结构与跨位置能力 ---------- */

    async listSubdirs(dir) {
      const fs = await fsReady()
      const { path: p, opts } = await targetOf(dir)
      try {
        const entries = await fs.readDir(p, opts as Parameters<typeof fs.readDir>[1])
        return entries.filter((e) => e.isDirectory).map((e) => e.name)
      } catch {
        return []
      }
    },
    async listTree(dir) {
      const fs = await fsReady()
      const { path: p, opts } = await targetOf(dir)
      const out: string[] = []
      const walk = async (rel: string) => {
        let entries
        try {
          entries = await fs.readDir(rel === '' ? p : `${p}/${rel}`, opts as Parameters<typeof fs.readDir>[1])
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
      const { path: p, opts } = await targetOf(rel)
      try {
        await fs.remove(p, { recursive: true, ...opts } as Parameters<typeof fs.remove>[1])
      } catch {
        /* 目录不存在视为成功 */
      }
      ensuredDirs.clear()
    },
    async writeBinary(rel, bytes) {
      const fs = await fsReady()
      await ensureDir(rel)
      const { path: p, opts } = await targetOf(rel)
      await fs.writeFile(p, bytes, opts as Parameters<typeof fs.writeFile>[2])
      return true
    },
    async readBinary(rel) {
      const fs = await fsReady()
      const { path: p, opts } = await targetOf(rel)
      try {
        return await fs.readFile(p, opts as Parameters<typeof fs.readFile>[1])
      } catch {
        return null
      }
    },
    async absOf(rel) {
      const { path } = await targetOf(rel)
      return path
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
      const { path: p } = await targetOf(destRel)
      await fs.copyFile(srcAbs, p)
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
        if (await fs.exists(`${DATA_DIR}/${POINTER_FILE}`, { baseDir: baseDirOf(fs, defRoot!) })) return false
        return !(await fs.exists(`${DATA_DIR}/libraries`, { baseDir: baseDirOf(fs, defRoot!) }))
      } catch {
        return false
      }
    },
    async probeExistingRoots() {
      const fs = await fsReady()
      return probeExistingRoots(fs, defRoot!)
    },
    async looksLikeDataDir(abs) {
      const fs = await fsReady()
      return looksLikeDataDir(fs, abs)
    },
    async describeDefaultRoot() {
      await ready
      try {
        return `${await describeBaseDir(defRoot!)}/${DATA_DIR}`
      } catch {
        return DATA_DIR
      }
    },
    async setDataRoot(path) {
      const fs = await fsReady()
      if (path) {
        if (!(await writableAbsDir(fs, path))) throw new Error('所选文件夹不可写')
        await fs.mkdir(path, { recursive: true }).catch(() => undefined)
        root = { abs: path }
      } else {
        root = { base: defRoot! }
      }
      ensuredDirs.clear()
      // 指针写入默认数据文件夹：即使之后自定义位置失效，下次启动也能从默认根读到指针并回退
      const bd = baseDirOf(fs, defRoot!)
      await fs.mkdir(DATA_DIR, { baseDir: bd, recursive: true }).catch(() => undefined)
      await fs.writeTextFile(`${DATA_DIR}/${POINTER_FILE}`, JSON.stringify({ dataRoot: path ?? null }, null, 2), {
        baseDir: bd,
      })
    },
  }
}
