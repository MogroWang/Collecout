import type { Block, ParsedDoc } from '../parsers/types'
import type { FieldDef, FieldKind, Template } from '../models'

/** 字段名 → 语义桶的同义词表，用于列映射与自动识别 */
export const FIELD_BUCKETS: Record<string, string[]> = {
  date: ['日期', '时间', '日期时间', 'date', 'time', 'day', '发生日期', '创建时间', '截止', '到期', '完成日期', '发布日期'],
  title: ['标题', '名称', '主题', '题目', 'title', 'name', 'subject', '事项', '项目'],
  amount: ['金额', '数量', '数值', '价格', '单价', '合计', '总额', 'amount', 'quantity', 'price', 'count', '费用', '支出', '收入'],
  note: ['备注', '说明', '描述', '摘要', '内容', 'note', 'notes', 'remark', 'description', 'content', 'detail', '详情', '记录'],
  tag: ['标签', '分类', '类别', '类型', 'category', 'tag', 'type', '分组'],
  person: ['负责人', '作者', '参与人', '经手人', 'author', 'owner', 'person', '姓名', '经办人', '参会人', '人员'],
  location: ['地点', '位置', 'location', 'place', '地址'],
  status: ['状态', '进度', 'status', 'state'],
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[\s（）()]/g, '')
}

function bucketOf(name: string): string | null {
  const n = norm(name)
  for (const [bucket, words] of Object.entries(FIELD_BUCKETS)) {
    if (words.some((w) => n === norm(w))) return bucket
  }
  return null
}

/** 两个名称是否指向同一语义（同义或包含） */
export function nameAffinity(a: string, b: string): number {
  const x = norm(a)
  const y = norm(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (bucketOf(x) && bucketOf(x) === bucketOf(y)) return 0.9
  if (x.includes(y) || y.includes(x)) return 0.75
  return 0
}

export interface ColumnMapping {
  mapping: Record<string, number>
  scores: Record<string, number>
}

/** 表头列与模板字段的映射建议 */
export function suggestColumnMapping(header: string[], template: Template, sampleRows: string[][]): ColumnMapping {
  const mapping: Record<string, number> = {}
  const scores: Record<string, number> = {}
  for (const field of template.fields) {
    let best = -1
    let bestScore = 0
    for (let c = 0; c < header.length; c++) {
      let score = nameAffinity(field.name, header[c])
      if (score > 0) {
        const kindScore = kindConsistency(field.kind, sampleRows.map((r) => r[c] ?? ''))
        score = Math.max(score, Math.min(0.9, score + kindScore * 0.15))
      }
      if (score > bestScore) {
        bestScore = score
        best = c
      }
    }
    if (best >= 0 && bestScore >= 0.5) {
      mapping[field.id] = best
      scores[field.id] = bestScore
    }
  }
  return { mapping, scores }
}

export function kindConsistency(kind: FieldKind, values: string[]): number {
  const samples = values.filter((v) => v !== '')
  if (samples.length === 0) return 0
  const hit = samples.slice(0, 12).filter((v) => valueLooksLike(kind, v)).length
  return hit / Math.min(samples.length, 12)
}

export function valueLooksLike(kind: FieldKind, v: string): boolean {
  switch (kind) {
    case 'date':
      return /\d{4}\s*[年\-/.]\s*\d{1,2}/.test(v) || /\d{1,2}\s*月\s*\d{1,2}\s*日/.test(v)
    case 'number':
      return /^-?\d[\d,，]*(?:\.\d+)?%?$/.test(v.trim())
    case 'tag':
      return false
    case 'text':
      return false
  }
}

export function inferKindFromSamples(values: string[]): FieldKind {
  const samples = values.filter((v) => v !== '')
  if (samples.length === 0) return 'text'
  if (kindConsistency('date', samples) >= 0.6) return 'date'
  if (kindConsistency('number', samples) >= 0.6) return 'number'
  const unique = new Set(samples)
  if (unique.size <= Math.max(2, samples.length * 0.3) && samples.length >= 4) return 'tag'
  return 'text'
}

/** 表格布局预设：auto 按结构现场判断，其余两种由用户显式指定 */
export type TableLayout = 'auto' | 'headerTop' | 'headerLeft'

export interface NormalizedTable {
  header: string[]
  rows: string[][]
  layout: 'headerTop' | 'headerLeft'
  /** 每条数据（rows[i]）在原工作表中的 0 起始行号；headerLeft 布局为原列号 */
  sourceMap?: number[]
}

/**
 * 「第一列为字段名」的表转置为「第一行为表头」。
 * grid 包含原首行（此布局下它不是表头，而是普通数据行）。
 */
export function transposeGrid(grid: string[][]): { header: string[]; rows: string[][] } {
  if (grid.length === 0) return { header: [], rows: [] }
  const width = Math.max(...grid.map((r) => r.length))
  const header: string[] = grid.map((r) => (r[0] ?? '').trim())
  const rows: string[][] = []
  for (let c = 1; c < width; c++) {
    rows.push(grid.map((r) => (r[c] ?? '').trim()))
  }
  return { header, rows }
}

/** 判断整张表更像「左侧列为字段名」的纵排表（字段-值对照，如个人简历页） */
export function looksHeaderLeft(grid: string[][]): boolean {
  if (grid.length < 3) return false
  const width = Math.max(...grid.map((r) => r.length))
  if (width < 2 || width > 8) return false
  const labels = grid.map((r) => (r[0] ?? '').trim()).filter((s) => s !== '')
  if (labels.length < grid.length * 0.8) return false
  if (new Set(labels).size < labels.length * 0.7) return false
  if (width === 2) {
    // 两列：字段-值表通常行数有限，且取值列类型混杂（数字文字混着来）
    if (grid.length > 15) return false
    const values = grid.map((r) => (r[1] ?? '').trim()).filter((s) => s !== '')
    if (values.length === 0) return false
    return kindConsistency('date', values) < 0.6 && kindConsistency('number', values) < 0.6
  }
  // 多列：字段数明显多于记录数才倾向纵排
  return grid.length >= width * 2
}

/** 按布局预设整理表格；auto 时现场判断并回传实际采用的布局。
 *  rowMap：原表格各行在工作表中的 0 起始行号（含表头行），用于把数据行对回工作表行。 */
export function applyTableLayout(
  table: { header: string[]; rows: string[][]; rowMap?: number[] },
  layout: TableLayout,
): NormalizedTable {
  const dataCount = table.rows.length
  if (layout === 'headerLeft') {
    return { ...transposeGrid([table.header, ...table.rows]), layout: 'headerLeft', sourceMap: table.rows.map((_, i) => i + 1) }
  }
  if (layout === 'auto' && looksHeaderLeft([table.header, ...table.rows])) {
    return { ...transposeGrid([table.header, ...table.rows]), layout: 'headerLeft', sourceMap: table.rows.map((_, i) => i + 1) }
  }
  const sourceMap = table.rowMap ? table.rowMap.slice(1) : table.rows.map((_, i) => i + 1)
  void dataCount
  return { header: table.header, rows: table.rows, layout: 'headerTop', sourceMap }
}

function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, '')
}

/** 多份字段表按字段名合并（同名去重，保留首次出现的定义），用于跨文件 / 跨工作表入库 */
export function mergeFieldsByName(fieldsList: FieldDef[][]): FieldDef[] {
  const out: FieldDef[] = []
  const seen = new Set<string>()
  for (const fields of fieldsList) {
    for (const f of fields) {
      const key = normName(f.name)
      if (key === '' || seen.has(key)) continue
      seen.add(key)
      out.push({ ...f })
    }
  }
  return out
}

export interface InferredImport {
  template: Template
  mode: 'table' | 'document'
  tableIndex?: number
  /** 整理后的表格（已按布局预设转置）；仅表格模式返回 */
  table?: { header: string[]; rows: string[][]; sourceMap?: number[] }
  /** auto 布局现场判断出的实际布局 */
  resolvedLayout?: 'headerTop' | 'headerLeft'
}

const MAX_FIELDS = 12

export interface InferOptions {
  /** 指定使用第几个表格块（多工作表选择），缺省取行数最多的表 */
  tableIndex?: number
  /** 表格布局预设，缺省 auto */
  layout?: TableLayout
}

/** 「自动识别」：根据文档结构推断模板与导入模式 */
export function inferTemplate(doc: ParsedDoc, builtinTemplateId: string, opts: InferOptions = {}): InferredImport {
  const tables = doc.blocks.filter((b): b is Extract<Block, { type: 'table' }> => b.type === 'table')
  const paras = doc.blocks.filter((b) => b.type === 'para' || b.type === 'listItem')
  const tableRows = tables.reduce((n, t) => n + t.rows.length, 0)

  const explicit = opts.tableIndex !== undefined && tables[opts.tableIndex] !== undefined
  if (tables.length > 0 && (tableRows >= Math.max(3, paras.length) || explicit)) {
    // 表格主导：默认取行数最多的表，指定 tableIndex 时以用户选择为准
    let table = tables[0]
    if (explicit) table = tables[opts.tableIndex as number]
    else for (const t of tables) if (t.rows.length > table.rows.length) table = t
    const normalized = applyTableLayout({ header: table.header, rows: table.rows, rowMap: table.rowMap }, opts.layout ?? 'auto')
    const fields: FieldDef[] = normalized.header.slice(0, MAX_FIELDS).map((name, i) => {
      const samples = normalized.rows.slice(0, 20).map((r) => r[i] ?? '')
      return {
        id: `f_col${i}`,
        name: name || `列${i + 1}`,
        kind: inferKindFromSamples(samples),
        strategy: 'tableMap' as const,
      }
    })
    return {
      mode: 'table',
      tableIndex: doc.blocks.indexOf(table),
      table: { header: normalized.header, rows: normalized.rows, sourceMap: normalized.sourceMap },
      resolvedLayout: normalized.layout,
      template: {
        id: builtinTemplateId,
        name: '自动识别',
        description: `按表头「${normalized.header.slice(0, 4).filter(Boolean).join('、')}」等 ${fields.length} 列提取`,
        builtin: true,
        fields,
      },
    }
  }

  // 文档模式：标题 + 日期 + 摘要 + key:value 行里的字段
  const fields: FieldDef[] = [
    { id: 'f_title', name: '标题', kind: 'text', strategy: 'auto' },
    { id: 'f_date', name: '日期', kind: 'date', strategy: 'auto' },
    { id: 'f_summary', name: '摘要', kind: 'text', strategy: 'auto' },
  ]
  const seen = new Set(fields.map((f) => f.name))
  // 标题/日期/摘要三个默认字段已覆盖对应语义桶，其余 key:value 保留为字段
  const coveredBuckets = new Set(['title', 'date', 'note'])
  for (const { key } of collectKeyValue(paras as { text: string }[])) {
    if (fields.length >= MAX_FIELDS) break
    const clean = key.trim()
    if (!clean || seen.has(clean)) continue
    const bucket = bucketOf(clean)
    if (bucket && coveredBuckets.has(bucket)) continue
    if (clean.length > 8) continue
    seen.add(clean)
    fields.push({ id: `f_kv_${clean}`, name: clean, kind: 'text', strategy: 'keyword' })
  }
  return {
    mode: 'document',
    template: {
      id: builtinTemplateId,
      name: '自动识别',
      description: `识别出 ${fields.length} 个字段（含 key:value 行）`,
      builtin: true,
      fields,
    },
  }
}

export interface KVPair {
  key: string
  value: string
}

const KV_RE = /^([^\s:：]{1,16})\s*[:：]\s*(.{1,300})$/

/** 收集段落与列表项里的「key: value」行 */
export function collectKeyValue(lines: { text: string }[]): KVPair[] {
  const pairs: KVPair[] = []
  for (const line of lines) {
    const m = KV_RE.exec(line.text.trim())
    if (m) pairs.push({ key: m[1], value: m[2].trim() })
  }
  return pairs
}

export function findDominantTable(blocks: Block[]): Extract<Block, { type: 'table' }> | null {
  const tables = blocks.filter((b): b is Extract<Block, { type: 'table' }> => b.type === 'table')
  if (tables.length === 0) return null
  return tables.reduce((a, b) => (b.rows.length > a.rows.length ? b : a))
}
