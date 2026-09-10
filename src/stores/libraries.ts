import { defineStore } from 'pinia'
import type { Entry, FieldDef, Library, SourceKind, StoredFile } from '../core/models'
import { newEntry, uuid } from '../core/models'
import { BUILTIN_TEMPLATES, inferKindFromSamples, type DraftEntry } from '../core/extract'
import { externalLibraryDir, isExternalLibrary, repo } from '../core/storage/repo'

function libFile(id: string): string {
  return `libraries/${id}/library.json`
}

function persist(lib: Library) {
  lib.updatedAt = new Date().toISOString()
  void repo().saveLibrary(lib)
}

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '')
}

/** 生成外部库文件夹名：用库名，与目录中已有条目重名时追加序号 */
async function pickExternalFolderName(dir: string, name: string): Promise<string> {
  const base = (name.trim().replace(/[\\/:*?"<>|\n\r\t]/g, '-').trim() || '未命名库').slice(0, 60)
  let candidate = base
  for (let n = 2; await repo().adapter.existsAbs?.(`${dir}/${candidate}`); n++) {
    candidate = `${base}（${n}）`
  }
  return candidate
}

/** 库文件夹 files/ 内不重名的存储名 */
async function pickStoredName(lib: Library, wanted: string): Promise<string> {
  const r = repo()
  const existing = new Set<string>()
  try {
    if (isExternalLibrary(lib)) {
      const names = await r.adapter.listDirAbs?.(`${externalLibraryDir(lib)}/files`)
      for (const n of names ?? []) existing.add(n)
    } else if (r.adapter.listTree) {
      for (const rel of await r.adapter.listTree(`libraries/${lib.id}/files`)) {
        existing.add(rel.split('/').pop() ?? rel)
      }
    }
  } catch {
    /* 列不出来就按空集合处理 */
  }
  if (!existing.has(wanted)) return wanted
  const dot = wanted.lastIndexOf('.')
  const stem = dot > 0 ? wanted.slice(0, dot) : wanted
  const ext = dot > 0 ? wanted.slice(dot) : ''
  for (let n = 2; ; n++) {
    const candidate = `${stem}（${n}）${ext}`
    if (!existing.has(candidate)) return candidate
  }
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

/* ---------- 追加入库的重复 / 冲突检测 ---------- */

function titleFieldOf(fields: FieldDef[]): FieldDef | undefined {
  return (
    fields.find((f) => f.kind === 'text' && /标题|主题|题目|书名|项目|name|title/i.test(f.name)) ??
    fields.find((f) => f.kind === 'text')
  )
}

function normValue(v: string | number | undefined): string {
  return String(v ?? '').trim().toLowerCase().replace(/\s+/g, '')
}

/** 条目身份键：优先用标题字段，没有文本字段时用全部字段值拼接 */
function entryKey(values: Record<string, string | number>, fields: FieldDef[]): string {
  const title = titleFieldOf(fields)
  if (title && values[title.id] !== undefined && String(values[title.id]).trim() !== '') {
    return normValue(values[title.id] as string)
  }
  return fields
    .map((f) => normValue(values[f.id] as string))
    .filter((s) => s !== '')
    .join('\u0001')
}

function sameValues(a: Record<string, string | number>, b: Record<string, string | number>, fields: FieldDef[]): boolean {
  return fields.every((f) => {
    const av = a[f.id]
    const bv = b[f.id]
    return (av === undefined || String(av) === '') === (bv === undefined || String(bv) === '') &&
      (av === undefined || String(av) === '' || normValue(av as string) === normValue(bv as string))
  })
}

export interface AppendConflict {
  /** 草稿在批次中的下标 */
  index: number
  /** 冲突的现有条目 */
  existing: Entry
  kind: 'duplicate' | 'conflict'
}

export interface AppendPlan {
  /** 完全重复（所有字段值一致），默认覆盖 */
  duplicates: AppendConflict[]
  /** 键相同但字段值不同，需要用户决定 */
  conflicts: AppendConflict[]
}

/** 每条冲突的处理决定（draftIndex → 覆盖现有 / 跳过） */
export type ConflictDecision = 'overwrite' | 'skip'

export interface AppendOptions {
  /** 冲突项的处理决定（draft 下标 → 决定）；未列出的冲突项按 skip 处理。重复项始终覆盖。 */
  decisions?: Record<number, ConflictDecision>
}

export interface AppendResult {
  added: number
  overwritten: number
  skipped: number
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
    /**
     * 新建库。storageDir 为 null/undefined 时存放在软件数据文件夹内；
     * 传入目录（桌面端）时库文件独立存放到该位置。
     */
    async create(name: string, templateId: string, fields: FieldDef[] = [], storageDir: string | null = null): Promise<Library> {
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
        storagePath: storageDir,
        fileName: null,
      }
      if (storageDir) {
        lib.fileName = await pickExternalFolderName(storageDir, lib.name)
        await repo().saveLibrary(lib)
      } else {
        lib.storagePath = null
        await repo().saveNow(libFile(lib.id), lib)
      }
      this.libraries.unshift(lib)
      return lib
    },
    rename(id: string, name: string) {
      const lib = this.byId(id)
      if (!lib) return
      lib.name = name.trim() || lib.name
      persist(lib)
    },
    /** 把库文件夹搬到另一个位置（null = 搬回数据文件夹内部），返回更新后的库 */
    async moveLibrary(id: string, newDir: string | null): Promise<Library | null> {
      const lib = this.byId(id)
      if (!lib) return null
      const samePlace =
        (newDir === null && !isExternalLibrary(lib)) ||
        (newDir !== null && isExternalLibrary(lib) && lib.storagePath === newDir)
      if (samePlace) return lib
      const folderName = isExternalLibrary(lib)
        ? await pickExternalFolderName(newDir ?? '', lib.fileName!)
        : await pickExternalFolderName(newDir ?? '', lib.name)
      const moved = await repo().moveLibrary(lib, newDir, folderName)
      Object.assign(lib, { storagePath: moved.storagePath, fileName: moved.fileName })
      return moved
    },
    /**
     * 把本次导入的源文件存档进库（复制副本或记录原位置），并与同名来源合并。
     * stored 里每个文件带 srcAbs（桌面端复制）或 bytes（安卓写入）；
     * isImage + anchor 标记 Excel 单元格图片。
     */
    async addSource(
      id: string,
      source: { fileName: string; kind: SourceKind },
      stored: { name: string; srcAbs?: string; bytes?: Uint8Array; isImage?: boolean; anchor?: { sheet: string; row: number; col: number } }[],
      fileMode: 'copy' | 'link',
    ): Promise<StoredFile[]> {
      const lib = this.byId(id)
      if (!lib) return []
      const now = new Date().toISOString()
      const records: StoredFile[] = []
      for (const f of stored) {
        const storedAs = await pickStoredName(lib, f.name)
        const rec: StoredFile = {
          id: uuid(),
          name: f.name,
          storedAs,
          mode: fileMode,
          kind: f.isImage ? 'image' : 'source',
          anchor: f.anchor,
          importedAt: now,
        }
        if (fileMode === 'link' && !f.isImage) {
          rec.sourcePath = f.srcAbs
        } else if (f.srcAbs !== undefined) {
          const ok = await repo().copyFileIntoLibrary(lib, f.srcAbs, storedAs)
          if (!ok) {
            rec.mode = 'link'
            rec.sourcePath = f.srcAbs
          }
        } else if (f.bytes !== undefined) {
          const ok = await repo().writeLibraryBinary(lib, storedAs, f.bytes)
          if (!ok) rec.mode = 'link'
        }
        records.push(rec)
      }
      await repo().ensureAttachmentDir(lib)
      let doc = lib.sources.find((s) => s.fileName === source.fileName)
      if (!doc) {
        doc = { ...source, importedAt: now, entryCount: 0, files: [] }
        lib.sources.push(doc)
      }
      doc.files = [...(doc.files ?? []), ...records]
      persist(lib)
      return records
    },
    /**
     * 把带单元格锚点的图片映射到对应条目：
     * 表格模式下行锚点 → 该行的条目、列锚点 → 该列的条目；映射不上的仅留在来源档案里。
     */
    async attachEntryImages(id: string, sourceFileName: string, imageRecords: StoredFile[]): Promise<void> {
      const lib = this.byId(id)
      if (!lib) return
      let changed = false
      for (const rec of imageRecords) {
        if (!rec.anchor) continue
        const { sheet, row, col } = rec.anchor
        const rowLoc = `「${sheet}」第 ${row + 1} 行`
        const colLoc = `「${sheet}」第 ${col + 1} 列`
        const entry = lib.entries.find(
          (e) => e.sourceRef.fileName === sourceFileName && (e.sourceRef.locator === rowLoc || e.sourceRef.locator === colLoc),
        )
        if (!entry) continue
        entry.images = [...(entry.images ?? []), rec.storedAs]
        changed = true
      }
      if (changed) persist(lib)
    },
    /** 读取库内图片字节，返回 Blob（展示用）；平台不支持或未存储时为 null */
    async readImage(id: string, storedAs: string): Promise<Blob | null> {
      const lib = this.byId(id)
      if (!lib) return null
      const bytes = await repo().readLibraryBinary(lib, storedAs)
      if (!bytes) return null
      const ext = storedAs.split('.').pop()?.toLowerCase() ?? ''
      const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : ext === 'bmp' ? 'image/bmp' : 'image/jpeg'
      return new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime })
    },
    async remove(id: string) {
      const lib = this.byId(id)
      this.libraries = this.libraries.filter((l) => l.id !== id)
      if (lib) await repo().removeLibrary(lib)
      else await repo().adapter.removeTree?.(`libraries/${id}`)
    },
    /** 外部库文件的绝对路径（设置页 / 库页展示用） */
    describeLocation(lib: Library): string {
      return isExternalLibrary(lib) ? externalLibraryDir(lib) : '软件数据文件夹'
    },
    /**
     * 追加入库前预检：把草稿值按字段名映射到库字段后，
     * 与现有条目比对身份键，区分完全重复与冲突。
     * fields 是合并后的完整字段表（库字段 + 本次导入新增字段）。
     */
    planAppend(
      id: string,
      drafts: DraftEntry[],
      sourceFields: FieldDef[],
    ): { plan: AppendPlan; remapped: Record<string, string | number>[]; fields: FieldDef[] } {
      const lib = this.byId(id)
      if (!lib) return { plan: { duplicates: [], conflicts: [] }, remapped: [], fields: sourceFields }
      const fields = Array.isArray(lib.fields) ? lib.fields : []

      const byName = new Map<string, FieldDef>()
      for (const f of fields) byName.set(normName(f.name), f)
      const remap = new Map<string, FieldDef>()
      const pending: FieldDef[] = []
      for (const sf of sourceFields) {
        const key = normName(sf.name)
        if (key === '') continue
        let target = byName.get(key)
        if (!target) {
          target = { ...sf }
          pending.push(target)
          byName.set(key, target)
        }
        remap.set(sf.id, target)
      }
      const allFields = [...fields, ...pending]

      const existingKeys = new Map<string, Entry>()
      for (const entry of lib.entries) {
        const key = entryKey(entry.values, allFields)
        if (key !== '') existingKeys.set(key, entry)
      }

      const remapped = drafts.map((d) => {
        const values: Record<string, string | number> = {}
        for (const [fid, v] of Object.entries(d.values)) {
          const target = remap.get(fid)
          if (target) values[target.id] = v
        }
        return values
      })

      const duplicates: AppendConflict[] = []
      const conflicts: AppendConflict[] = []
      remapped.forEach((values, index) => {
        const key = entryKey(values, allFields)
        if (key === '') return
        const existing = existingKeys.get(key)
        if (!existing) return
        if (sameValues(values, existing.values, allFields)) {
          duplicates.push({ index, existing, kind: 'duplicate' })
        } else {
          conflicts.push({ index, existing, kind: 'conflict' })
        }
      })
      return { plan: { duplicates, conflicts }, remapped, fields: allFields }
    },
    /**
     * 把草稿条目并入库。草稿的值按「导入现场字段」的 id 记录，
     * 这里按字段名重映射到库自己的字段；库里没有的字段（新列）会补充进库字段表。
     *
     * 追加时的重复 / 冲突处理：身份键相同的条目视为重复 → 覆盖现有条目；
     * 值存在差异的冲突项按 decisions 决定覆盖或跳过，未提供决定时跳过。
     */
    async addEntries(
      id: string,
      drafts: DraftEntry[],
      source: { fileName: string; kind: SourceKind },
      sourceFields: FieldDef[] = [],
      options: AppendOptions = {},
    ): Promise<AppendResult> {
      const lib = this.byId(id)
      if (!lib) return { added: 0, overwritten: 0, skipped: 0 }
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

      const existingKeys = new Map<string, Entry>()
      for (const entry of lib.entries) {
        const key = entryKey(entry.values, lib.fields)
        if (key !== '') existingKeys.set(key, entry)
      }

      const fresh: Entry[] = []
      const result: AppendResult = { added: 0, overwritten: 0, skipped: 0 }
      const now = new Date().toISOString()
      drafts.forEach((d, draftIndex) => {
        const entry = newEntry(id, d.sourceRef)
        for (const [fid, v] of Object.entries(d.values)) {
          const target = remap.get(fid)
          if (!target) continue
          entry.values[target.id] = v
          const c = d.confidence[fid]
          if (c !== undefined) entry.confidence[target.id] = c
        }
        const key = entryKey(entry.values, lib.fields)
        const existing = key === '' ? undefined : existingKeys.get(key)
        if (!existing) {
          fresh.push(entry)
          if (key !== '') existingKeys.set(key, entry)
          return
        }
        if (sameValues(entry.values, existing.values, lib.fields)) {
          // 完全重复：默认覆盖（用导入内容刷新现有条目）
          existing.values = { ...entry.values }
          existing.confidence = { ...entry.confidence }
          existing.sourceRef = entry.sourceRef
          existing.updatedAt = now
          result.overwritten++
          return
        }
        const decision = options.decisions?.[draftIndex]
        if (decision === 'overwrite') {
          existing.values = { ...entry.values }
          existing.confidence = { ...entry.confidence }
          existing.sourceRef = entry.sourceRef
          existing.updatedAt = now
          result.overwritten++
        } else {
          result.skipped++
        }
      })

      lib.entries.push(...fresh)
      result.added = fresh.length
      const existingSource = lib.sources.find((s) => s.fileName === source.fileName)
      const total = result.added + result.overwritten
      if (existingSource) {
        existingSource.entryCount += total
      } else {
        lib.sources.push({ ...source, importedAt: now, entryCount: total })
      }
      persist(lib)
      return result
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
