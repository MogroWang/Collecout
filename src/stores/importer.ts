import { defineStore } from 'pinia'
import type { ParsedDoc } from '../core/parsers/types'
import type { Template } from '../core/models'
import { parseFile } from '../core/parsers'
import type { DraftEntry } from '../core/extract'
import { extractFromDocument, extractFromTable, findDominantTable, inferTemplate, suggestColumnMapping } from '../core/extract'
import { useLibrariesStore } from './libraries'
import { useTemplatesStore } from './templates'

export interface ImportFileState {
  id: string
  file: File
  doc: ParsedDoc | null
  error: string | null
  mode: 'table' | 'document' | null
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
      const templates = useTemplatesStore()
      for (const f of this.files) {
        f.drafts = []
        f.extracted = false
        f.mode = null
        f.inferred = null
        f.tableHeader = null
        f.tableRows = null
        f.tableLabel = null
        f.mapping = {}
        f.mappingScores = {}
        if (!f.doc) continue

        let fields: { template: Template; mode: 'table' | 'document'; tableIndex: number }
        if (templateId === AUTO_ID) {
          const inferred = inferTemplate(f.doc, AUTO_ID)
          fields = { template: inferred.template, mode: inferred.mode, tableIndex: inferred.tableIndex ?? -1 }
          f.inferred = inferred.template
        } else {
          const tpl = templates.byId(templateId)
          if (!tpl) continue
          fields = { template: tpl, mode: 'table', tableIndex: -1 }
          f.inferred = tpl
          const table = findDominantTable(f.doc.blocks)
          if (!(table && table.rows.length >= 3)) fields.mode = 'document'
        }

        if (fields.mode === 'table') {
          type TableBlock = Extract<ParsedDoc['blocks'][number], { type: 'table' }>
          const table =
            fields.tableIndex >= 0
              ? (f.doc.blocks[fields.tableIndex] as TableBlock)
              : (findDominantTable(f.doc.blocks) as TableBlock | null)
          if (!table) {
            f.mode = 'document'
          } else {
            f.mode = 'table'
            f.tableHeader = table.header
            f.tableRows = table.rows
            f.tableLabel = table.source ?? f.doc.fileName
            const suggestion = suggestColumnMapping(table.header, fields.template, table.rows.slice(0, 20))
            f.mapping = suggestion.mapping
            f.mappingScores = suggestion.scores
          }
        }
        if (f.mode === null) f.mode = 'document'
      }
    },
    extractAll() {
      for (const f of this.files) {
        if (!f.doc || f.mode === null || !f.inferred) continue
        const template = f.inferred
        if (f.mode === 'table' && f.tableHeader && f.tableRows) {
          f.drafts = extractFromTable(f.tableRows, template, f.mapping, f.mappingScores, {
            fileName: f.doc.fileName,
            locator: (i) => `「${f.tableLabel}」第 ${i + 2} 行`,
          })
        } else {
          f.drafts = extractFromDocument(f.doc.blocks, template, f.doc.fileName).entries
        }
        f.extracted = true
      }
    },
    async commit(): Promise<{ libraryId: string; count: number } | null> {
      const libraries = useLibrariesStore()
      const drafts = this.allDrafts
      if (drafts.length === 0) return null

      let libId = this.targetLibId
      if (this.targetMode === 'new') {
        const first = this.files.find((f) => f.doc !== null)
        const name = this.newLibName.trim() || first?.doc?.fileName.replace(/\.[^.]+$/, '') || '未命名库'
        const lib = await libraries.create(name, this.templateId ?? AUTO_ID)
        libId = lib.id
      }
      if (!libId) return null

      for (const f of this.files) {
        if (f.drafts.length === 0 || !f.doc) continue
        libraries.addEntries(libId, f.drafts, { fileName: f.doc.fileName, kind: f.doc.kind })
      }
      return { libraryId: libId, count: drafts.length }
    },
  },
})
