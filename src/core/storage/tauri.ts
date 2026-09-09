import type { StorageAdapter } from './adapter'

/**
 * Tauri 桌面端：基于 plugin-fs，数据在 AppData/collecout 下。
 * capabilities 里已授权 appdata 读写。
 */
export function createTauriAdapter(): StorageAdapter {
  const ensuredDirs = new Set<string>()
  const ensureDir = async (path: string) => {
    const dir = path.split('/').slice(0, -1).join('/')
    if (!dir || ensuredDirs.has(dir)) return
    const { mkdir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
    await mkdir(`collecout/${dir}`, { baseDir: BaseDirectory.AppData, recursive: true })
    ensuredDirs.add(dir)
  }
  return {
    async readText(path) {
      try {
        const { readTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
        return await readTextFile(`collecout/${path}`, { baseDir: BaseDirectory.AppData })
      } catch {
        return null
      }
    },
    async writeText(path, data) {
      await ensureDir(path)
      const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      await writeTextFile(`collecout/${path}`, data, { baseDir: BaseDirectory.AppData })
    },
    async remove(path) {
      try {
        const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs')
        await remove(`collecout/${path}`, { baseDir: BaseDirectory.AppData })
      } catch {
        /* 文件不存在视为成功 */
      }
    },
    async listFiles(dir) {
      try {
        const { readDir, BaseDirectory } = await import('@tauri-apps/plugin-fs')
        const entries = await readDir(`collecout/${dir}`, { baseDir: BaseDirectory.AppData })
        return entries.filter((e) => e.isFile).map((e) => e.name)
      } catch {
        return []
      }
    },
    async exists(path) {
      try {
        const { exists, BaseDirectory } = await import('@tauri-apps/plugin-fs')
        return await exists(`collecout/${path}`, { baseDir: BaseDirectory.AppData })
      } catch {
        return false
      }
    },
  }
}
