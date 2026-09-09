import { defineStore } from 'pinia'
import type { Entry, Library } from '../core/models'
import { newEntry } from '../core/models'
import type { DraftEntry } from '../core/extract'
import { repo } from '../core/storage/repo'

function libFile(id: string): string {
  return `libraries/${id}.json`
}

function persist(lib: Library) {
  lib.updatedAt = new Date().toISOString()
  repo().saveJSON(libFile(lib.id), lib)
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
      this.libraries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    },
    async create(name: string, templateId: string): Promise<Library> {
      const now = new Date().toISOString()
      const lib: Library = {
        id: crypto.randomUUID(),
        name: name.trim() || '未命名库',
        templateId,
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
    addEntries(id: string, drafts: DraftEntry[], source: { fileName: string; kind: 'docx' | 'xlsx' | 'text' }) {
      const lib = this.byId(id)
      if (!lib) return
      const entries = drafts.map((d) => {
        const entry = newEntry(id, d.sourceRef)
        entry.values = d.values
        entry.confidence = d.confidence
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
