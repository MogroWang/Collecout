// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { parseText } from './text'
import { htmlToBlocks } from './html'
import { parseSheet } from './xlsx'
import * as XLSX from 'xlsx'

describe('parseText 纯文本解析', () => {
  it('识别标题、列表与段落，跳过分隔线', () => {
    const blocks = parseText(['# 会议记录', '', '---', '时间：2026年8月28日', '- 第一项决议', '普通段落'].join('\n'))
    expect(blocks).toEqual([
      { type: 'heading', level: 1, text: '会议记录' },
      { type: 'para', text: '时间：2026年8月28日' },
      { type: 'listItem', text: '第一项决议' },
      { type: 'para', text: '普通段落' },
    ])
  })
})

describe('htmlToBlocks', () => {
  it('解析 mammoth 产出的 HTML 结构', () => {
    const html = '<h1>周会</h1><p>时间：2026年8月28日</p><ul><li>待办一</li></ul><table><tr><th>日期</th><th>金额</th></tr><tr><td>2026-08-01</td><td>32.5</td></tr></table>'
    const blocks = htmlToBlocks(html)
    expect(blocks[0]).toEqual({ type: 'heading', level: 1, text: '周会' })
    expect(blocks[1]).toEqual({ type: 'para', text: '时间：2026年8月28日' })
    expect(blocks[2]).toEqual({ type: 'listItem', text: '待办一' })
    const table = blocks[3]
    expect(table.type).toBe('table')
    if (table.type === 'table') {
      expect(table.header).toEqual(['日期', '金额'])
      expect(table.rows).toEqual([['2026-08-01', '32.5']])
    }
  })
})

describe('parseSheet Excel 解析', () => {
  it('每个 sheet 一个表格块，首行为表头', () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([
      ['日期', '项目', '金额'],
      ['2026-08-01', '午餐', '32.5'],
      ['2026-08-02', '打车', '18'],
    ])
    XLSX.utils.book_append_sheet(wb, ws, '八月')
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const buf = new Uint8Array(out).buffer as ArrayBuffer
    const doc = parseSheet(buf, '流水.xlsx')
    expect(doc.kind).toBe('xlsx')
    expect(doc.blocks).toHaveLength(1)
    const table = doc.blocks[0]
    expect(table.type).toBe('table')
    if (table.type === 'table') {
      expect(table.source).toBe('八月')
      expect(table.header).toEqual(['日期', '项目', '金额'])
      expect(table.rows).toEqual([
        ['2026-08-01', '午餐', '32.5'],
        ['2026-08-02', '打车', '18'],
      ])
    }
  })
  it('跳过空 sheet', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['']]), '空表')
    const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    const buf = new Uint8Array(out).buffer as ArrayBuffer
    expect(parseSheet(buf, '空.xlsx').blocks).toHaveLength(0)
  })
})
