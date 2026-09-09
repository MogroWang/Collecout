import type { StorageAdapter } from './adapter'

/** Capacitor 安卓端：数据在应用私有 Data 目录的 collecout/ 下 */
export function createCapacitorAdapter(): StorageAdapter {
  const ensuredDirs = new Set<string>()
  const ensureDir = async (path: string) => {
    const dir = path.split('/').slice(0, -1).join('/')
    if (!dir || ensuredDirs.has(dir)) return
    const { Filesystem, Directory } = await import('@capacitor/filesystem')
    await Filesystem.mkdir({ path: `collecout/${dir}`, directory: Directory.Data, recursive: true }).catch(() => undefined)
    ensuredDirs.add(dir)
  }
  return {
    async readText(path) {
      try {
        const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
        const { data } = await Filesystem.readFile({ path: `collecout/${path}`, directory: Directory.Data, encoding: Encoding.UTF8 })
        return typeof data === 'string' ? data : null
      } catch {
        return null
      }
    },
    async writeText(path, data) {
      await ensureDir(path)
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
      await Filesystem.writeFile({ path: `collecout/${path}`, directory: Directory.Data, encoding: Encoding.UTF8, data, recursive: true })
    },
    async remove(path) {
      try {
        const { Filesystem, Directory } = await import('@capacitor/filesystem')
        await Filesystem.deleteFile({ path: `collecout/${path}`, directory: Directory.Data })
      } catch {
        /* 文件不存在视为成功 */
      }
    },
    async listFiles(dir) {
      try {
        const { Filesystem, Directory } = await import('@capacitor/filesystem')
        const { files } = await Filesystem.readdir({ path: `collecout/${dir}`, directory: Directory.Data })
        return files.map((f) => f.name)
      } catch {
        return []
      }
    },
    async exists(path) {
      try {
        const { Filesystem, Directory } = await import('@capacitor/filesystem')
        const r = await Filesystem.stat({ path: `collecout/${path}`, directory: Directory.Data })
        return r.type === 'file'
      } catch {
        return false
      }
    },
  }
}
