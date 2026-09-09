import { Filesystem, Directory, Encoding } from '@capacitor/filesystem'
import type { StorageAdapter } from './adapter'

/** 数据文件夹名 */
export const DATA_DIR = 'collecout-data'

/** 把 0.1.0 存在内部 Data 目录的数据迁移到外部专属目录（仅当目标为空时） */
async function migrateLegacy(): Promise<void> {
  try {
    const legacy = await Filesystem.readdir({ path: 'collecout', directory: Directory.Data }).catch(() => null)
    if (!legacy || legacy.files.length === 0) return
    const target = await Filesystem.readdir({ path: DATA_DIR, directory: Directory.External }).catch(() => null)
    if (target && target.files.length > 0) return
    await copyDir('collecout', DATA_DIR)
  } catch {
    /* 迁移失败不阻塞启动，用户数据仍在原处 */
  }
}

async function copyDir(rel: string, targetRel: string): Promise<void> {
  const { files } = await Filesystem.readdir({ path: rel, directory: Directory.Data })
  if (files.length === 0) return
  await Filesystem.mkdir({ path: targetRel, directory: Directory.External, recursive: true }).catch(() => undefined)
  for (const f of files) {
    const from = `${rel}/${f.name}`
    const to = `${targetRel}/${f.name}`
    if (f.type === 'directory') {
      await copyDir(from, to)
    } else {
      const { data } = await Filesystem.readFile({ path: from, directory: Directory.Data, encoding: Encoding.UTF8 })
      if (typeof data === 'string') {
        await Filesystem.writeFile({ path: to, directory: Directory.External, encoding: Encoding.UTF8, data, recursive: true })
      }
    }
  }
}

/** Capacitor 安卓端存储：应用外部专属目录 Android/data/<包名>/files/collecout-data */
export function createCapacitorAdapter(): StorageAdapter {
  const ensuredDirs = new Set<string>()
  void migrateLegacy()

  const ensureDir = async (path: string) => {
    const dir = path.split('/').slice(0, -1).join('/')
    if (!dir || ensuredDirs.has(dir)) return
    await Filesystem.mkdir({ path: `${DATA_DIR}/${dir}`, directory: Directory.External, recursive: true }).catch(() => undefined)
    ensuredDirs.add(dir)
  }

  return {
    async readText(path) {
      try {
        const { data } = await Filesystem.readFile({ path: `${DATA_DIR}/${path}`, directory: Directory.External, encoding: Encoding.UTF8 })
        return typeof data === 'string' ? data : null
      } catch {
        return null
      }
    },
    async writeText(path, data) {
      await ensureDir(path)
      await Filesystem.writeFile({ path: `${DATA_DIR}/${path}`, directory: Directory.External, encoding: Encoding.UTF8, data, recursive: true })
    },
    async remove(path) {
      try {
        await Filesystem.deleteFile({ path: `${DATA_DIR}/${path}`, directory: Directory.External })
      } catch {
        /* 文件不存在视为成功 */
      }
    },
    async listFiles(dir) {
      try {
        const { files } = await Filesystem.readdir({ path: `${DATA_DIR}/${dir}`, directory: Directory.External })
        return files.filter((f) => f.type === 'file').map((f) => f.name)
      } catch {
        return []
      }
    },
    async exists(path) {
      try {
        const r = await Filesystem.stat({ path: `${DATA_DIR}/${path}`, directory: Directory.External })
        return r.type === 'file'
      } catch {
        return false
      }
    },
    async describeRoot() {
      try {
        const { uri } = await Filesystem.getUri({ path: DATA_DIR, directory: Directory.External })
        return decodeURIComponent(uri)
      } catch {
        return 'Android/data/…/files/collecout-data'
      }
    },
  }
}
