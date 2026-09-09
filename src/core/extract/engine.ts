import type { Block } from '../parsers/types'
import type { EntryValue, FieldDef, SourceRef, Template } from '../models'
import { findDates, normalizeDateValue, normalizeNumberValue } from './datetime'
import { collectKeyValue, nameAffinity } from './suggest'

export interface DraftEntry {
  values: Record<string, EntryValue>
  confidence: Record<string, number>
  sourceRef: SourceRef
}

export interface DocumentExtraction {
  mode: 'log' | 'document'
  entries: DraftEntry[]
}

const MAX_TEXT = 500

function textBlocks(blocks: Block[]): string[] {
  return blocks
    .filter((b): b is Exclude<Block, { type: 'table' }> => b.type !== 'table')
    .map((b) => b.text)
}

function normalize(field: FieldDef, value: string): { value: EntryValue; ok: boolean } {
  const v = value.trim().slice(0, MAX_TEXT)
  if (v === '') return { value: '', ok: false }
  if (field.kind === 'date') {
    const iso = normalizeDateValue(v)
    return iso ? { value: iso, ok: true } : { value: v, ok: false }
  }
  if (field.kind === 'number') {
    const n = normalizeNumberValue(v)
    return n !== null ? { value: n, ok: true } : { value: v, ok: false }
  }
  return { value: v, ok: true }
}

/** 表格模式：按列映射把每一行抽成一条草稿条目 */
export function extractFromTable(
  rows: string[][],
  template: Template,
  mapping: Record<string, number>,
  scores: Record<string, number>,
  sourceRef: Omit<SourceRef, 'locator'> & { locator: (rowIdx: number) => string },
): DraftEntry[] {
  const entries: DraftEntry[] = []
  rows.forEach((row, i) => {
    const values: Record<string, EntryValue> = {}
    const confidence: Record<string, number> = {}
    let any = false
    for (const field of template.fields) {
      const col = mapping[field.id]
      if (col === undefined) continue
      const raw = row[col] ?? ''
      if (raw === '') continue
      any = true
      const { value, ok } = normalize(field, raw)
      values[field.id] = value
      confidence[field.id] = ok ? (scores[field.id] ?? 0.7) : 0.4
    }
    if (any) {
      entries.push({ values, confidence, sourceRef: { fileName: sourceRef.fileName, locator: sourceRef.locator(i) } })
    }
  })
  return entries
}

/** 文档模式：整篇或日志式拆条 */
export function extractFromDocument(blocks: Block[], template: Template, fileName: string): DocumentExtraction {
  const log = extractLogEntries(blocks, template, fileName)
  if (log) return { mode: 'log', entries: log }

  const lines = textBlocks(blocks)
  const kv = collectKeyValue(blocks.filter((b): b is Exclude<Block, { type: 'table' }> => b.type !== 'table'))
  const values: Record<string, EntryValue> = {}
  const confidence: Record<string, number> = {}
  for (const field of template.fields) {
    const hit = extractOneField(field, blocks, lines, kv)
    if (hit && hit.value !== '') {
      values[field.id] = hit.value
      confidence[field.id] = hit.conf
    }
  }
  return {
    mode: 'document',
    entries: [{ values, confidence, sourceRef: { fileName, locator: '全文' } }],
  }
}

interface FieldHit {
  value: EntryValue
  conf: number
}

function extractOneField(field: FieldDef, blocks: Block[], lines: string[], kv: { key: string; value: string }[]): FieldHit | null {
  if (field.strategy === 'regex' && field.pattern) {
    const hit = extractByRegex(field, lines)
    if (hit) return hit
  }
  if (field.strategy === 'heading') {
    const hit = extractByHeading(field, blocks)
    if (hit) return hit
  }
  if (field.strategy === 'keyword') {
    const hit = extractByKeyword(field, lines, kv)
    if (hit) return hit
  }
  // auto 及未命中时的兜底
  switch (field.kind) {
    case 'date':
      return extractAutoDate(field, lines, kv)
    case 'number':
      return extractByKeyword(field, lines, kv) ?? extractAutoNumber(field, lines)
    case 'tag':
      return extractByKeyword(field, lines, kv) ?? extractAutoTag(lines)
    case 'text':
      return extractByKeyword(field, lines, kv) ?? extractAutoText(field, blocks)
  }
}

function keywordCandidates(field: FieldDef): string[] {
  return [field.name, ...(field.keywords ?? [])].filter((k) => k.trim() !== '')
}

function extractByKeyword(field: FieldDef, lines: string[], kv: { key: string; value: string }[]): FieldHit | null {
  const candidates = keywordCandidates(field)
  // 1) key:value 完全匹配
  for (const kw of candidates) {
    const pair = kv.find((p) => nameAffinity(p.key, kw) >= 0.9)
    if (pair) {
      const { value, ok } = normalize(field, pair.value)
      return { value, conf: ok ? 0.9 : 0.55 }
    }
  }
  // 2) 行首「关键词：值」
  for (const kw of candidates) {
    const re = new RegExp(`^\\s*${escapeRe(kw)}\\s*[:：\\-—]\\s*(.{1,300})$`)
    for (const line of lines) {
      const m = re.exec(line)
      if (m) {
        const { value, ok } = normalize(field, m[1])
        return { value, conf: ok ? 0.85 : 0.5 }
      }
    }
  }
  // 3) 行内「关键词：值」
  for (const kw of candidates) {
    const re = new RegExp(`${escapeRe(kw)}\\s*[:：]\\s*(.{1,200}?)(?:[，。；]|$)`)
    for (const line of lines) {
      const m = re.exec(line)
      if (m) {
        const { value, ok } = normalize(field, m[1])
        return { value, conf: ok ? 0.7 : 0.45 }
      }
    }
  }
  return null
}

function extractByRegex(field: FieldDef, lines: string[]): FieldHit | null {
  if (!field.pattern) return null
  let re: RegExp
  try {
    re = new RegExp(field.pattern)
  } catch {
    return null
  }
  for (const line of lines) {
    const m = re.exec(line)
    if (m) {
      const { value, ok } = normalize(field, m[1] ?? m[0])
      return { value, conf: ok ? 0.8 : 0.4 }
    }
  }
  return null
}

function extractByHeading(field: FieldDef, blocks: Block[]): FieldHit | null {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.type !== 'heading') continue
    if (nameAffinity(b.text, field.name) < 0.75) continue
    const parts: string[] = []
    for (let j = i + 1; j < blocks.length; j++) {
      const n = blocks[j]
      if (n.type === 'heading' && n.level <= b.level) break
      if (n.type !== 'table') parts.push(n.text)
    }
    if (parts.length > 0) {
      const { value } = normalize(field, parts.join('；'))
      return { value, conf: 0.7 }
    }
  }
  return null
}

function extractAutoDate(field: FieldDef, lines: string[], kv: { key: string; value: string }[]): FieldHit | null {
  const candidates = [...keywordCandidates(field), '日期', '时间', 'date']
  for (const kw of candidates) {
    const pair = kv.find((p) => nameAffinity(p.key, kw) >= 0.9)
    if (pair) {
      const iso = normalizeDateValue(pair.value)
      if (iso) return { value: iso, conf: 0.9 }
    }
  }
  const all = lines.map((l) => findDates(l)).filter((hits) => hits.length > 0)
  if (all.length === 0) return null
  const wantLast = /截止|到期|结束|最后|截至/.test(field.name)
  const hit = wantLast ? all[all.length - 1][0] : all[0][0]
  return { value: hit.iso, conf: 0.75 }
}

function extractAutoNumber(field: FieldDef, lines: string[]): FieldHit | null {
  const re = new RegExp(`${escapeRe(field.name)}\\D{0,4}?(-?[\\d,，]+(?:\\.\\d+)?)`)
  for (const line of lines) {
    const m = re.exec(line)
    if (m) {
      const n = normalizeNumberValue(m[1])
      if (n !== null) return { value: n, conf: 0.6 }
    }
  }
  return null
}

function extractAutoTag(lines: string[]): FieldHit | null {
  const tags: string[] = []
  for (const line of lines) {
    for (const m of line.matchAll(/[#＃]([^\s#＃，。;；]{1,12})/g)) {
      tags.push(m[1])
      if (tags.length >= 3) return { value: tags.join('、'), conf: 0.6 }
    }
  }
  return null
}

function extractAutoText(field: FieldDef, blocks: Block[]): FieldHit | null {
  const paras = blocks.filter((b): b is Exclude<Block, { type: 'table' } | { type: 'heading' }> => b.type !== 'table' && b.type !== 'heading')
  if (/标题|主题|题目|name|title/i.test(field.name)) {
    const heading = blocks.find((b): b is Extract<Block, { type: 'heading' }> => b.type === 'heading')
    if (heading) return { value: heading.text.slice(0, MAX_TEXT), conf: 0.75 }
    const short = paras.find((p) => p.text.length <= 30)
    if (short) return { value: short.text, conf: 0.5 }
  }
  if (/摘要|内容|正文|详情|描述|备注|summary|content/i.test(field.name)) {
    const long = [...paras].sort((a, b) => b.text.length - a.text.length)[0]
    if (long && long.text.length >= 8) {
      const { value } = normalize(field, long.text)
      return { value, conf: 0.5 }
    }
  }
  return null
}

/** 日志式文档：段首出现日期的段落占一半以上且 ≥4 段时，按日期拆成多条 */
function extractLogEntries(blocks: Block[], template: Template, fileName: string): DraftEntry[] | null {
  const paras = blocks.filter((b): b is Exclude<Block, { type: 'table' } | { type: 'heading' }> => b.type !== 'table' && b.type !== 'heading')
  const dated: { idx: number; iso: string; rest: string }[] = []
  paras.forEach((p, idx) => {
    const hits = findDates(p.text)
    if (hits.length > 0 && hits[0].index <= 2 && hits[0].text.length <= 16) {
      dated.push({ idx, iso: hits[0].iso, rest: p.text.slice(hits[0].index + hits[0].text.length).replace(/^[\s，,、:：-]+/, '') })
    }
  })
  if (dated.length < 4 || dated.length < paras.length * 0.5) return null

  const dateField = template.fields.find((f) => f.kind === 'date')
  const textField = template.fields.find((f) => f.kind === 'text' && /内容|摘要|记录|事项|正文|note|content/i.test(f.name))
    ?? template.fields.find((f) => f.kind === 'text')
  return dated.map((d) => {
    const values: Record<string, EntryValue> = {}
    const confidence: Record<string, number> = {}
    if (dateField) {
      values[dateField.id] = d.iso
      confidence[dateField.id] = 0.85
    }
    if (textField) {
      values[textField.id] = d.rest.slice(0, MAX_TEXT) || d.rest
      confidence[textField.id] = 0.7
    }
    return { values, confidence, sourceRef: { fileName, locator: `正文第 ${d.idx + 1} 段` } }
  })
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
