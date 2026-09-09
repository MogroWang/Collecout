import { describe, expect, it } from 'vitest'
import type { Entry, FieldDef } from '../models'
import { applyFilters, EMPTY_FILTER, sortEntries, type FilterState } from './filter'

const fields: FieldDef[] = [
  { id: 'title', name: '标题', kind: 'text', strategy: 'auto' },
  { id: 'date', name: '日期', kind: 'date', strategy: 'auto' },
  { id: 'amount', name: '金额', kind: 'number', strategy: 'auto' },
  { id: 'tag', name: '类别', kind: 'tag', strategy: 'auto' },
]

let seq = 0
function entry(values: Record<string, string | number>): Entry {
  return {
    id: `e${seq++}`,
    libraryId: 'lib',
    values,
    confidence: {},
    sourceRef: { fileName: 'a.txt', locator: '' },
    createdAt: '',
    updatedAt: '',
  }
}

const entries = [
  entry({ title: '周会纪要', date: '2026-08-01', amount: 100, tag: '会议' }),
  entry({ title: '读书笔记', date: '2026-08-15', amount: 32.5, tag: '学习' }),
  entry({ title: '月度复盘', date: '2026-09-01', amount: 0, tag: '会议' }),
]

describe('applyFilters', () => {
  it('无筛选时全量返回', () => {
    expect(applyFilters(entries, fields, EMPTY_FILTER)).toHaveLength(3)
  })
  it('按日期区间筛选', () => {
    const filter: FilterState = { search: '', rules: [{ id: 'r1', fieldId: 'date', op: 'dateBetween', from: '2026-08-01', to: '2026-08-31' }] }
    expect(applyFilters(entries, fields, filter)).toHaveLength(2)
  })
  it('按数值区间筛选', () => {
    const filter: FilterState = { search: '', rules: [{ id: 'r1', fieldId: 'amount', op: 'numberBetween', min: '50', max: '' }] }
    expect(applyFilters(entries, fields, filter)).toHaveLength(1)
  })
  it('按包含文本筛选', () => {
    const filter: FilterState = { search: '', rules: [{ id: 'r1', fieldId: 'title', op: 'contains', text: '纪要' }] }
    expect(applyFilters(entries, fields, filter)).toHaveLength(1)
  })
  it('按标签任一命中筛选', () => {
    const filter: FilterState = { search: '', rules: [{ id: 'r1', fieldId: 'tag', op: 'isAnyOf', text: '会议、复盘' }] }
    expect(applyFilters(entries, fields, filter)).toHaveLength(2)
  })
  it('搜索覆盖所有字段', () => {
    expect(applyFilters(entries, fields, { search: '读书', rules: [] })).toHaveLength(1)
    expect(applyFilters(entries, fields, { search: '学习', rules: [] })).toHaveLength(1)
    expect(applyFilters(entries, fields, { search: '不存在', rules: [] })).toHaveLength(0)
  })
  it('多条规则取交集', () => {
    const filter: FilterState = {
      search: '',
      rules: [
        { id: 'r1', fieldId: 'date', op: 'dateBetween', from: '2026-08-01', to: '2026-08-31' },
        { id: 'r2', fieldId: 'tag', op: 'isAnyOf', text: '会议' },
      ],
    }
    expect(applyFilters(entries, fields, filter)).toHaveLength(1)
  })
})

describe('sortEntries', () => {
  it('数字字段降序', () => {
    const sorted = sortEntries(entries, fields, 'amount', 'desc')
    expect(sorted.map((e) => e.values.amount)).toEqual([100, 32.5, 0])
  })
  it('日期字段升序', () => {
    const sorted = sortEntries(entries, fields, 'date', 'asc')
    expect(sorted[0].values.date).toBe('2026-08-01')
  })
  it('中文文本按拼音区域排序', () => {
    const sorted = sortEntries(entries, fields, 'title', 'asc')
    expect(sorted.map((e) => e.values.title)).toEqual(['读书笔记', '月度复盘', '周会纪要'])
  })
})
