import type { Entry, EntryValue, FieldDef } from '../models'
import { normalizeNumberValue } from '../extract/datetime'

export type FilterRule =
  | { id: string; fieldId: string; op: 'dateBetween'; from: string; to: string }
  | { id: string; fieldId: string; op: 'numberBetween'; min: string; max: string }
  | { id: string; fieldId: string; op: 'contains'; text: string }
  | { id: string; fieldId: string; op: 'isAnyOf'; text: string }

export interface FilterState {
  search: string
  rules: FilterRule[]
}

export const EMPTY_FILTER: FilterState = { search: '', rules: [] }

function fieldOf(fields: FieldDef[], id: string): FieldDef | undefined {
  return fields.find((f) => f.id === id)
}

function valueOf(entry: Entry, fieldId: string): EntryValue | undefined {
  return entry.values[fieldId]
}

function matchesRule(entry: Entry, rule: FilterRule, fields: FieldDef[]): boolean {
  const field = fieldOf(fields, rule.fieldId)
  if (!field) return true
  const raw = valueOf(entry, rule.fieldId)
  const str = raw === undefined ? '' : String(raw)
  switch (rule.op) {
    case 'dateBetween': {
      if (raw === undefined || str === '') return false
      if (rule.from && str < rule.from) return false
      if (rule.to && str > rule.to) return false
      return true
    }
    case 'numberBetween': {
      const n = typeof raw === 'number' ? raw : raw === undefined ? null : normalizeNumberValue(str)
      if (n === null) return false
      const min = rule.min === '' ? null : normalizeNumberValue(rule.min)
      const max = rule.max === '' ? null : normalizeNumberValue(rule.max)
      if (min !== null && n < min) return false
      if (max !== null && n > max) return false
      return true
    }
    case 'contains':
      return str.toLowerCase().includes(rule.text.toLowerCase())
    case 'isAnyOf': {
      if (str === '') return false
      const wanted = rule.text.split(/[、,，;；]/).map((s) => s.trim()).filter(Boolean)
      if (wanted.length === 0) return true
      return wanted.some((w) => str.includes(w))
    }
  }
}

/** 依次应用搜索与全部筛选规则，返回命中的条目 */
export function applyFilters(entries: Entry[], fields: FieldDef[], filter: FilterState): Entry[] {
  const q = filter.search.trim().toLowerCase()
  return entries.filter((entry) => {
    if (q !== '') {
      const haystack = fields.map((f) => String(entry.values[f.id] ?? '')).join('\n').toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return filter.rules.every((rule) => matchesRule(entry, rule, fields))
  })
}

export type SortDir = 'asc' | 'desc'

export function sortEntries(entries: Entry[], fields: FieldDef[], fieldId: string, dir: SortDir): Entry[] {
  const field = fieldOf(fields, fieldId)
  const factor = dir === 'asc' ? 1 : -1
  return [...entries].sort((a, b) => {
    const av = a.values[fieldId]
    const bv = b.values[fieldId]
    if (av === undefined && bv === undefined) return 0
    if (av === undefined) return 1
    if (bv === undefined) return -1
    if (field?.kind === 'number') {
      const an = typeof av === 'number' ? av : (normalizeNumberValue(String(av)) ?? Number.NaN)
      const bn = typeof bv === 'number' ? bv : (normalizeNumberValue(String(bv)) ?? Number.NaN)
      if (Number.isNaN(an) && Number.isNaN(bn)) return 0
      if (Number.isNaN(an)) return 1
      if (Number.isNaN(bn)) return -1
      return (an - bn) * factor
    }
    return String(av).localeCompare(String(bv), 'zh-Hans-CN') * factor
  })
}
