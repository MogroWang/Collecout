import type { StorageAdapter } from './adapter'

const PREFIX = 'collecout:'

/** 浏览器预览模式：数据放在 localStorage，仅用于开发调试，不承载真实数据 */
export function createWebAdapter(): StorageAdapter {
  const ls = globalThis.localStorage
  return {
    async readText(path) {
      return ls.getItem(PREFIX + path)
    },
    async writeText(path, data) {
      ls.setItem(PREFIX + path, data)
    },
    async remove(path) {
      ls.removeItem(PREFIX + path)
    },
    async listFiles(dir) {
      const prefix = PREFIX + dir + '/'
      const names: string[] = []
      for (let i = 0; i < ls.length; i++) {
        const key = ls.key(i)
        if (key && key.startsWith(prefix)) names.push(key.slice(prefix.length))
      }
      return names.filter((n) => !n.includes('/'))
    },
    async exists(path) {
      return ls.getItem(PREFIX + path) !== null
    },
    async listSubdirs(dir) {
      const prefix = PREFIX + dir + '/'
      const names = new Set<string>()
      for (let i = 0; i < ls.length; i++) {
        const key = ls.key(i)
        if (key && key.startsWith(prefix)) {
          const rest = key.slice(prefix.length)
          if (rest.includes('/')) names.add(rest.split('/')[0])
        }
      }
      return [...names]
    },
    async listTree(dir) {
      const prefix = PREFIX + dir + '/'
      const names: string[] = []
      for (let i = 0; i < ls.length; i++) {
        const key = ls.key(i)
        if (key && key.startsWith(prefix)) names.push(key.slice(prefix.length))
      }
      return names
    },
    async removeTree(rel) {
      const prefix = PREFIX + rel + '/'
      const doomed: string[] = []
      for (let i = 0; i < ls.length; i++) {
        const key = ls.key(i)
        if (key && key.startsWith(prefix)) doomed.push(key)
      }
      for (const key of doomed) ls.removeItem(key)
    },
  }
}
