import { defineStore } from 'pinia'
import type { ParsedDoc } from '../core/parsers/types'
import type { ExtractedImage } from '../core/parsers/xlsx'
import type { Entry, FieldDef, StoredFile, Template } from '../core/models'
import { parseFile } from '../core/parsers'
import type { DraftEntry } from '../core/extract'
import { extractFromDocument, extractFromTable, inferTemplate, mergeFieldsByName, suggestColumnMapping, applyTableLayout, type TableLayout } from '../core/extract'
import { useLibrariesStore } from './libraries'
import { useTemplatesStore } from './templates'

export interface TableCandidate {
  /** 工作表名（xlsx）或来源标记 */
  label: string
  header: string[]
  rows: string[][]
  /** rows[i]（含表头行）在工作表中的 0 起始行号 */
  rowMap?: number[]
}

/** 一个待导入文件：桌面端带绝对路径（可复制存档），其他平台带 File 对象 */
export interface ImportFileRef {
  name: string
  path?: string
  file?: File
}

export interface ImportFileState {
  id: string
  name: string
  /** 桌面端的源文件绝对路径（复制存档用） */
  path?: string
  /** 非桌面端的 File 对象（解析 / 字节读取用） */
  file?: File
  doc: ParsedDoc | null
  /** xlsx 单元格图片（parseSheet 提取） */
  images: ExtractedImage[]
  error: string | null
  mode: 'table' | 'document' | null
  /** 全部候选表格：xlsx 每个工作表一个，docx 每张表一个 */
  tables: TableCandidate[]
  activeTable: number
  /** 用户是否主动切换过工作表；未切换时自动识别仍按整篇文档判断模式 */
  sheetChosen: boolean
  /** 表格布局预设：自动 / 首行为标题栏 / 首列为标题栏 */
  layout: TableLayout
  /** 实际采用的布局（auto 判断后的结果） */
  resolvedLayout: 'headerTop' | 'headerLeft' | null
  /** 该文件实际使用的模板（自动识别时是现场推断的） */
  inferred: Template | null
  tableHeader: string[] | null
  tableRows: string[][] | null
  /** 每条数据在工作表中的 0 起始行号（headerLeft 时为列号） */
  tableSourceMap: number[] | null
  tableLabel: string | null
  mapping: Record<string, number>
  mappingScores: Record<string, number>
  drafts: DraftEntry[]
  extracted: boolean
}

const AUTO_ID = 'tpl_auto'

async function readBytes(ref: ImportFileRef): Promise<Uint8Array> {
  if (ref.path) {
    const { readFile } = await import('@tauri-apps/plugin-fs')
    return await readFile(ref.path)
  }
  if (ref.file) return new Uint8Array(await ref.file.arrayBuffer())
  throw new Error('没有可读取的文件内容')
}

function blankFileState(ref: ImportFileRef): ImportFileState {
  return {
    id: crypto.randomUUID(),
    name: ref.name,
    path: ref.path,
    file: ref.file,
    doc: null,
    images: [],
    error: null,
    mode: null,
    tables: [],
    activeTable: 0,
    sheetChosen: false,
    layout: 'auto',
    resolvedLayout: null,
    inferred: null,
    tableHeader: null,
    tableRows: null,
    tableSourceMap: null,
    tableLabel: null,
    mapping: {},
    mappingScores: {},
    drafts: [],
    extracted: false,
  }
}

export const useImporterStore = defineStore('importer', {
  state: () => ({
    step: 1,
    files: [] as ImportFileState[],
    templateId: AUTO_ID as string | null,
    targetMode: 'new' as 'new' | 'append',
    newLibName: '',
    /** 新建库时的独立存放目录（null = 软件数据文件夹） */
    newLibDir: null as string | null,
    targetLibId: '',
    busy: false,
  }),
  getters: {
    parsedCount: (s) => s.files.filter((f) => f.doc !== null).length,
    errorCount: (s) => s.files.filter((f) => f.error !== null).length,
    allDrafts(state): DraftEntry[] {
      return state.files.flatMap((f) => f.drafts)
    },
    lowConfidenceCount(state): number {
      return state.files.reduce(
        (n, f) => n + f.drafts.reduce((m, d) => m + Object.values(d.confidence).filter((c) => c < 0.6).length, 0),
        0,
      )
    },
  },
  actions: {
    reset() {
      this.step = 1
      this.files = []
      this.templateId = AUTO_ID
      this.targetMode = 'new'
      this.newLibName = ''
      this.newLibDir = null
      this.targetLibId = ''
      this.busy = false
    },
    async addFiles(list: ImportFileRef[]) {
      for (const ref of list) {
        const state = blankFileState(ref)
        this.files.push(state)
        // 取回响应式代理后再异步赋值，直接改原始对象不会触发界面更新
        const rx = this.files[this.files.length - 1] as ImportFileState
        try {
          const bytes = await readBytes(ref)
          rx.doc = await parseFile(ref.name, bytes)
          rx.images = rx.doc.images ?? []
          rx.tables = rx.doc.blocks
            .filter((b): b is Extract<ParsedDoc['blocks'][number], { type: 'table' }> => b.type === 'table')
            .map((b) => ({ label: b.source ?? rx.doc!.fileName, header: b.header, rows: b.rows, rowMap: b.rowMap }))
          // 默认聚焦行数最多的工作表
          let best = 0
          for (let i = 0; i < rx.tables.length; i++) {
            if (rx.tables[i].rows.length > rx.tables[best].rows.length) best = i
          }
          rx.activeTable = best
          // 可解析的文件里一个内容块都没有才提示错误；附件文件（kind=file）不算错误
          if (rx.doc.kind !== 'file' && rx.doc.blocks.length === 0) {
            rx.error = `「${ref.name}」里没有可识别的内容`
          }
        } catch (err) {
          rx.error = err instanceof Error ? err.message : `「${ref.name}」解析失败`
        }
      }
      if (this.templateId) this.prepareTemplate(this.templateId)
    },
    removeFile(id: string) {
      this.files = this.files.filter((f) => f.id !== id)
    },
    /** 选定模板后，为每个文件确定提取模式并给出列映射建议 */
    prepareTemplate(templateId: string) {
      this.templateId = templateId
      for (const f of this.files) {
        this.retune(f as ImportFileState)
      }
    },
    /** 切换某个文件的工作表 */
    setActiveSheet(fileId: string, index: number) {
      const f = this.files.find((x) => x.id === fileId) as ImportFileState | undefined
      if (!f || index < 0 || index >= f.tables.length) return
      f.activeTable = index
      f.sheetChosen = true
      this.retune(f)
      this.extractFile(f)
    },
    /** 切换某个文件的表格布局预设 */
    setLayout(fileId: string, layout: TableLayout) {
      const f = this.files.find((x) => x.id === fileId) as ImportFileState | undefined
      if (!f) return
      f.layout = layout
      this.retune(f)
      this.extractFile(f)
    },
    /** 按当前模板 / 工作表 / 布局重新推断一个文件的模式、字段与列映射 */
    retune(f: ImportFileState) {
      const templates = useTemplatesStore()
      f.drafts = []
      f.extracted = false
      f.mode = null
      f.inferred = null
      f.tableHeader = null
      f.tableRows = null
      f.tableSourceMap = null
      f.tableLabel = null
      f.mapping = {}
      f.mappingScores = {}
      f.resolvedLayout = null
      if (!f.doc || f.doc.kind === 'file') return

      if (this.templateId === AUTO_ID) {
        // 未主动选工作表时保持旧行为：按整篇文档判断模式，表格取行数最多的那张
        const inferred = inferTemplate(f.doc, AUTO_ID, {
          tableIndex: f.sheetChosen ? f.activeTable : undefined,
          layout: f.layout,
        })
        f.inferred = inferred.template
        f.mode = inferred.mode
        f.resolvedLayout = inferred.resolvedLayout ?? null
        if (inferred.mode === 'table' && inferred.table) {
          const candidate = f.tables[f.activeTable]
          f.tableHeader = inferred.table.header
          f.tableRows = inferred.table.rows
          f.tableSourceMap = inferred.table.sourceMap ?? null
          f.tableLabel = candidate?.label ?? f.doc.fileName
          const suggestion = suggestColumnMapping(inferred.table.header, inferred.template, inferred.table.rows.slice(0, 20))
          f.mapping = suggestion.mapping
          f.mappingScores = suggestion.scores
        }
      } else {
        const tpl = templates.byId(this.templateId ?? AUTO_ID)
        if (!tpl) return
        f.inferred = tpl
        const candidate = f.tables[f.activeTable]
        if (candidate && candidate.rows.length >= 3) {
          const normalized = applyTableLayout({ header: candidate.header, rows: candidate.rows }, f.layout)
          f.mode = 'table'
          f.resolvedLayout = normalized.layout
          f.tableHeader = normalized.header
          f.tableRows = normalized.rows
          f.tableSourceMap = normalized.sourceMap ?? null
          f.tableLabel = candidate.label
          const suggestion = suggestColumnMapping(normalized.header, tpl, normalized.rows.slice(0, 20))
          f.mapping = suggestion.mapping
          f.mappingScores = suggestion.scores
        } else {
          f.mode = 'document'
        }
      }
      if (f.mode === null) f.mode = 'document'
    },
    /** 提取单个文件（表格按列映射，文档按模板规则） */
    extractFile(f: ImportFileState) {
      if (!f.doc || f.mode === null || !f.inferred) return
      const template = f.inferred
      if (f.mode === 'table' && f.tableHeader && f.tableRows) {
        const sourceMap = f.tableSourceMap ?? []
        const isCol = f.resolvedLayout === 'headerLeft'
        const unit = isCol ? '列' : '行'
        f.drafts = extractFromTable(
          f.tableRows,
          template,
          f.mapping,
          f.mappingScores,
          {
            fileName: f.doc.fileName,
            locator: (i) => `「${f.tableLabel}」第 ${(sourceMap[i] ?? i + 1) + 1} ${unit}`,
          },
          (i) => (isCol ? { sourceCol: sourceMap[i] ?? i + 1 } : { sourceRow: sourceMap[i] ?? i + 1 }),
        )
      } else {
        f.drafts = extractFromDocument(f.doc.blocks, template, f.doc.fileName).entries
      }
      f.extracted = true
    },
    extractAll() {
      for (const f of this.files) {
        this.extractFile(f as ImportFileState)
      }
    },
    /** 所有文件推断出的字段按名字合并，作为新库的字段快照 */
    mergedFields(): FieldDef[] {
      const list = this.files.filter((f) => f.inferred).map((f) => (f as ImportFileState).inferred!.fields)
      return mergeFieldsByName(list)
    },
    /**
     * 入库。新建库时可用 storageDir 指定独立存放位置；
     * fileMode 决定源文件存档方式：'copy' 复制进库文件夹（默认），'link' 仅记录原位置（桌面端）；
     * 追加时通过 decisions 传递每个文件的冲突条目处理决定（draft 下标 → 覆盖/跳过）。
     */
    async commit(
      decisions: Record<string, Record<number, 'overwrite' | 'skip'>> = {},
      storageDir: string | null = null,
      fileMode: 'copy' | 'link' = 'copy',
    ): Promise<{ libraryId: string; count: number; added: number; overwritten: number; skipped: number } | null> {
      const libraries = useLibrariesStore()
      const drafts = this.allDrafts
      if (drafts.length === 0 && !this.files.some((f) => f.doc)) return null

      let libId = this.targetLibId
      if (this.targetMode === 'new') {
        const first = this.files.find((f) => f.doc !== null)
        const name = this.newLibName.trim() || first?.doc?.fileName.replace(/\.[^.]+$/, '') || '未命名库'
        const lib = await libraries.create(name, this.templateId ?? AUTO_ID, this.mergedFields(), storageDir)
        libId = lib.id
      }
      if (!libId) return null

      const total = { added: 0, overwritten: 0, skipped: 0 }
      for (const f of this.files) {
        if (!f.doc) continue
        const r =
          f.drafts.length > 0
            ? await libraries.addEntries(libId, f.drafts, { fileName: f.doc.fileName, kind: f.doc.kind }, f.inferred?.fields ?? [], {
                decisions: decisions[f.id],
              })
            : { added: 0, overwritten: 0, skipped: 0, entries: [] as (Entry | null)[] }
        total.added += r.added
        total.overwritten += r.overwritten
        total.skipped += r.skipped
        // 源文件存档：copy 复制进库文件夹；link 记录原位置（仅桌面端有路径）
        const stored: { name: string; srcAbs?: string; bytes?: Uint8Array }[] = []
        if (f.path) stored.push({ name: f.doc.fileName, srcAbs: f.path })
        else if (fileMode === 'copy' && f.file) stored.push({ name: f.doc.fileName, bytes: new Uint8Array(await f.file.arrayBuffer()) })
        // Excel 单元格图片一并存档（带单元格锚点）
        const storedImages: { name: string; bytes: Uint8Array; anchor: { sheet: string; row: number; col: number } }[] =
          f.images.map((img) => ({ name: img.name, bytes: img.bytes, anchor: { sheet: img.sheet, row: img.row, col: img.col } }))
        let records: StoredFile[] = []
        if (stored.length > 0 || storedImages.length > 0) {
          records = await libraries.addSource(
            libId,
            { fileName: f.doc.fileName, kind: f.doc.kind },
            [...stored, ...storedImages.map((s) => ({ ...s, isImage: true }))],
            fileMode,
          )
        }
        // 图片按锚点映射：行 → 条目，列 → 表头 → 字段（图片与该列文字一样随字段展示）
        const imageRecords = records.filter((rec) => rec.kind === 'image')
        if (imageRecords.length > 0 && r.entries.length > 0) {
          const label = f.tableLabel ?? ''
          const isCol = f.drafts.some((d) => d.sourceCol !== undefined)
          const pairs: { entryId: string; storedAs: string; fieldId?: string }[] = []
          for (const rec of imageRecords) {
            if (!rec.anchor || rec.anchor.sheet !== label) continue
            const di = f.drafts.findIndex((d) =>
              isCol ? d.sourceCol === rec.anchor!.col : d.sourceRow === rec.anchor!.row,
            )
            if (di === -1) continue
            const entry = r.entries[di]
            if (!entry) continue
            // 列 → 表头文字 → 字段 id（列布局下图片锚定的是原表「行」，退化为条目级）
            let fieldId: string | undefined
            if (!isCol) {
              const col = rec.anchor!.col
              fieldId = Object.entries(f.mapping).find(([, colIndex]) => colIndex === col)?.[0]
            }
            pairs.push({ entryId: entry.id, storedAs: rec.storedAs, fieldId })
          }
          if (pairs.length > 0) await libraries.attachEntryImages(libId, pairs)
        }
      }
      return { libraryId: libId, count: total.added + total.overwritten, ...total }
    },
  },
})
