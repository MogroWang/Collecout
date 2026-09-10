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
    /** 预览模式：二进制以 base64 文本存入 localStorage（限额 ~5MB，仅供开发调试） */
    async writeBinary(rel, bytes) {
      let bin = ''
      const chunk = 0x8000
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
      }
      try {
        ls.setItem(PREFIX + rel, btoa(bin))
        return true
      } catch {
        return false
      }
    },
    async readBinary(rel) {
      const b64 = ls.getItem(PREFIX + rel)
      if (b64 === null) return null
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      return bytes
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
