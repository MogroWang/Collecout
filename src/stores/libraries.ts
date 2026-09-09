import { defineStore } from 'pinia'
import type { Entry, FieldDef, Library } from '../core/models'
import { newEntry, uuid } from '../core/models'
import { BUILTIN_TEMPLATES, inferKindFromSamples, type DraftEntry } from '../core/extract'
import { repo } from '../core/storage/repo'

function libFile(id: string): string {
  return `libraries/${id}.json`
}

function persist(lib: Library) {
  lib.updatedAt = new Date().toISOString()
  void repo().saveNow(libFile(lib.id), lib)
}

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '')
}

/**
 * 0.1.0 的旧库没有字段快照（值按推断字段 id 存，但展示用的「自动识别」模板没有字段，
 * 导致入库后内容不可见）。这里从模板或条目值键名重建字段表。
 */
function rebuildLegacyFields(lib: Library): FieldDef[] {
  if (Array.isArray(lib.fields) && lib.fields.length > 0) return lib.fields
  const builtin = BUILTIN_TEMPLATES.find((t) => t.id === lib.templateId)
  if (builtin && builtin.fields.length > 0) return builtin.fields.map((f) => ({ ...f }))

  // 自动识别的旧库：按推断 id 的命名规则还原字段名
  const names = new Map<string, string>()
  const order: string[] = []
  for (const entry of lib.entries) {
    for (const key of Object.keys(entry.values)) {
      if (names.has(key)) continue
      order.push(key)
      let name = `字段 ${names.size + 1}`
      if (key === 'f_title') name = '标题'
      else if (key === 'f_date') name = '日期'
      else if (key === 'f_summary') name = '摘要'
      else if (key.startsWith('f_kv_')) name = key.slice(5)
      else if (/^f_col\d+$/.test(key)) name = `列${Number(key.slice(5)) + 1}`
      else if (key.startsWith('bf_')) {
        const tail = key.replace(/^bf_\d+_/, '')
        name = tail || name
      }
      names.set(key, name)
    }
  }
  return order.map((id) => {
    const samples = lib.entries.map((e) => e.values[id]).filter((v) => v !== undefined).map(String)
    return { id, name: names.get(id) ?? id, kind: inferKindFromSamples(samples), strategy: 'auto' as const }
  })
}

export const useLibrariesStore = defineStore('libraries', {
  state: () => ({
    libraries: [] as Library[],
  }),
  getters: {
    byId(state) {
      return (id: string) => state.libraries.find((l) => l.id === id)
    },
  },
  actions: {
    async load() {
      this.libraries = await repo().loadLibraries()
      for (const lib of this.libraries) {
        lib.fields = rebuildLegacyFields(lib)
      }
      this.libraries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },
    async create(name: string, templateId: string, fields: FieldDef[] = []): Promise<Library> {
      const now = new Date().toISOString()
      const lib: Library = {
        id: uuid(),
        name: name.trim() || '未命名库',
        templateId,
        fields,
        sources: [],
        entries: [],
        createdAt: now,
        updatedAt: now,
      }
      this.libraries.unshift(lib)
      await repo().saveNow(libFile(lib.id), lib)
      return lib
    },
    rename(id: string, name: string) {
      const lib = this.byId(id)
      if (!lib) return
      lib.name = name.trim() || lib.name
      persist(lib)
    },
    async remove(id: string) {
      this.libraries = this.libraries.filter((l) => l.id !== id)
      await repo().remove(libFile(id))
    },
    /**
     * 把草稿条目并入库。草稿的值按「导入现场字段」的 id 记录，
     * 这里按字段名重映射到库自己的字段；库里没有的字段（新列）会补充进库字段表。
     */
    async addEntries(
      id: string,
      drafts: DraftEntry[],
      source: { fileName: string; kind: 'docx' | 'xlsx' | 'text' },
      sourceFields: FieldDef[] = [],
    ): Promise<number> {
      const lib = this.byId(id)
      if (!lib) return 0
      if (!Array.isArray(lib.fields)) lib.fields = []

      const byName = new Map<string, FieldDef>()
      for (const f of lib.fields) byName.set(normName(f.name), f)
      const remap = new Map<string, FieldDef>()
      for (const sf of sourceFields) {
        const key = normName(sf.name)
        if (key === '') continue
        let target = byName.get(key)
        if (!target) {
          target = { ...sf }
          lib.fields.push(target)
          byName.set(key, target)
        }
        remap.set(sf.id, target)
      }

      const entries = drafts.map((d) => {
        const entry = newEntry(id, d.sourceRef)
        for (const [fid, v] of Object.entries(d.values)) {
          const target = remap.get(fid)
          if (!target) continue
          entry.values[target.id] = v
          const c = d.confidence[fid]
          if (c !== undefined) entry.confidence[target.id] = c
        }
        return entry
      })
      lib.entries.push(...entries)
      const existing = lib.sources.find((s) => s.fileName === source.fileName)
      if (existing) {
        existing.entryCount += entries.length
      } else {
        lib.sources.push({ ...source, importedAt: new Date().toISOString(), entryCount: entries.length })
      }
      persist(lib)
      return entries.length
    },
    updateEntry(id: string, entry: Entry) {
      const lib = this.byId(id)
      if (!lib) return
      const i = lib.entries.findIndex((e) => e.id === entry.id)
      if (i === -1) return
      lib.entries[i] = { ...entry, updatedAt: new Date().toISOString() }
      persist(lib)
    },
    removeEntries(id: string, entryIds: string[]) {
      const lib = this.byId(id)
      if (!lib) return
      const set = new Set(entryIds)
      lib.entries = lib.entries.filter((e) => !set.has(e.id))
      persist(lib)
    },
  },
})
