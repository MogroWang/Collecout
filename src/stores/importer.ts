import { defineStore } from 'pinia'
import type { ParsedDoc } from '../core/parsers/types'
import type { FieldDef, Template } from '../core/models'
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
}

export interface ImportFileState {
  id: string
  file: File
  doc: ParsedDoc | null
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
  tableLabel: string | null
  mapping: Record<string, number>
  mappingScores: Record<string, number>
  drafts: DraftEntry[]
  extracted: boolean
}

const AUTO_ID = 'tpl_auto'

function blankFileState(file: File): ImportFileState {
  return {
    id: crypto.randomUUID(),
    file,
    doc: null,
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
      this.targetLibId = ''
      this.busy = false
    },
    async addFiles(list: File[]) {
      for (const file of list) {
        const state = blankFileState(file)
        this.files.push(state)
        // 取回响应式代理后再异步赋值，直接改原始对象不会触发界面更新
        const rx = this.files[this.files.length - 1] as ImportFileState
        try {
          rx.doc = await parseFile(file)
          rx.tables = rx.doc.blocks
            .filter((b): b is Extract<ParsedDoc['blocks'][number], { type: 'table' }> => b.type === 'table')
            .map((b) => ({ label: b.source ?? rx.doc!.fileName, header: b.header, rows: b.rows }))
          // 默认聚焦行数最多的工作表
          let best = 0
          for (let i = 0; i < rx.tables.length; i++) {
            if (rx.tables[i].rows.length > rx.tables[best].rows.length) best = i
          }
          rx.activeTable = best
          if (rx.doc.blocks.length === 0) {
            rx.error = `「${file.name}」里没有可识别的内容`
          }
        } catch (err) {
          rx.error = err instanceof Error ? err.message : `「${file.name}」解析失败`
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
      f.tableLabel = null
      f.mapping = {}
      f.mappingScores = {}
      f.resolvedLayout = null
      if (!f.doc) return

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
        const unit = f.resolvedLayout === 'headerLeft' ? '列' : '行'
        f.drafts = extractFromTable(f.tableRows, template, f.mapping, f.mappingScores, {
          fileName: f.doc.fileName,
          locator: (i) => `「${f.tableLabel}」第 ${i + 2} ${unit}`,
        })
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
    async commit(): Promise<{ libraryId: string; count: number } | null> {
      const libraries = useLibrariesStore()
      const drafts = this.allDrafts
      if (drafts.length === 0) return null

      let libId = this.targetLibId
      if (this.targetMode === 'new') {
        const first = this.files.find((f) => f.doc !== null)
        const name = this.newLibName.trim() || first?.doc?.fileName.replace(/\.[^.]+$/, '') || '未命名库'
        const lib = await libraries.create(name, this.templateId ?? AUTO_ID, this.mergedFields())
        libId = lib.id
      }
      if (!libId) return null

      let count = 0
      for (const f of this.files) {
        if (f.drafts.length === 0 || !f.doc) continue
        count += await libraries.addEntries(libId, f.drafts, { fileName: f.doc.fileName, kind: f.doc.kind }, f.inferred?.fields ?? [])
      }
      return { libraryId: libId, count }
    },
  },
})
