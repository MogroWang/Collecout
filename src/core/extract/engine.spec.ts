import { describe, expect, it } from 'vitest'
import type { Block } from '../parsers/types'
import type { Template } from '../models'
import { extractFromDocument, extractFromTable } from './engine'

const meetingTpl: Template = {
  id: 't1',
  name: '会议纪要',
  description: '',
  builtin: false,
  fields: [
    { id: 'title', name: '主题', kind: 'text', strategy: 'auto' },
    { id: 'date', name: '日期', kind: 'date', strategy: 'auto' },
    { id: 'people', name: '参会人', kind: 'text', strategy: 'keyword' },
    { id: 'decision', name: '决议', kind: 'text', strategy: 'heading' },
  ],
}

const meetingBlocks: Block[] = [
  { type: 'heading', level: 1, text: '产品周会' },
  { type: 'para', text: '时间：2026年8月28日' },
  { type: 'para', text: '参会人：王明、李华、赵倩' },
  { type: 'heading', level: 2, text: '决议' },
  { type: 'para', text: '0.1.0 于 9月9日 发布' },
  { type: 'para', text: '安卓端同步内测' },
]

describe('extractFromDocument 会议纪要', () => {
  const { entries, mode } = extractFromDocument(meetingBlocks, meetingTpl, '周会.docx')
  it('走单条目文档模式', () => {
    expect(mode).toBe('document')
    expect(entries).toHaveLength(1)
  })
  it('标题取自首个标题块', () => {
    expect(entries[0].values.title).toBe('产品周会')
    expect(entries[0].confidence.title).toBeGreaterThanOrEqual(0.75)
  })
  it('key:value 里的时间识别为 ISO 日期', () => {
    expect(entries[0].values.date).toBe('2026-08-28')
    expect(entries[0].confidence.date).toBe(0.9)
  })
  it('关键词命中参会人', () => {
    expect(entries[0].values.people).toBe('王明、李华、赵倩')
  })
  it('标题分节归组决议内容', () => {
    expect(String(entries[0].values.decision)).toContain('0.1.0 于 9月9日 发布')
    expect(String(entries[0].values.decision)).toContain('安卓端同步内测')
  })
})

describe('extractFromDocument 日志模式', () => {
  const logTpl: Template = {
    id: 't2',
    name: '日志',
    description: '',
    builtin: false,
    fields: [
      { id: 'date', name: '日期', kind: 'date', strategy: 'auto' },
      { id: 'content', name: '内容', kind: 'text', strategy: 'auto' },
    ],
  }
  const blocks: Block[] = [
    { type: 'para', text: '2026-08-30 完成导入向导的状态机。' },
    { type: 'para', text: '2026-08-31 修复表格映射在空列上的崩溃。' },
    { type: 'para', text: '2026-09-01 增加置信度标记。' },
    { type: 'para', text: '2026-09-02 导出器支持文件夹模式。' },
  ]
  const { entries, mode } = extractFromDocument(blocks, logTpl, '日志.txt')
  it('按日期拆成多条', () => {
    expect(mode).toBe('log')
    expect(entries).toHaveLength(4)
    expect(entries[0].values.date).toBe('2026-08-30')
    expect(entries[0].values.content).toBe('完成导入向导的状态机。')
    expect(entries[3].sourceRef.locator).toContain('4')
  })
})

describe('extractFromTable', () => {
  const tpl: Template = {
    id: 't3',
    name: '流水',
    description: '',
    builtin: false,
    fields: [
      { id: 'date', name: '日期', kind: 'date', strategy: 'tableMap' },
      { id: 'amount', name: '金额', kind: 'number', strategy: 'tableMap' },
      { id: 'note', name: '备注', kind: 'text', strategy: 'tableMap' },
    ],
  }
  const rows = [
    ['2026-08-01', '午餐', '32.5', '工作餐'],
    ['2026-08-02', '打车', '18', '客户拜访'],
    ['', '', '', ''],
  ]
  it('按列映射抽取并归一化类型', () => {
    const entries = extractFromTable(rows, tpl, { date: 0, amount: 2, note: 3 }, { date: 0.9, amount: 1, note: 0.75 }, {
      fileName: '流水.xlsx',
      locator: (i) => `「Sheet1」第 ${i + 2} 行`,
    })
    expect(entries).toHaveLength(2)
    expect(entries[0].values.date).toBe('2026-08-01')
    expect(entries[0].values.amount).toBe(32.5)
    expect(entries[0].confidence.amount).toBe(1)
    expect(entries[1].sourceRef.locator).toBe('「Sheet1」第 3 行')
  })
  it('映射缺失的字段不产生值', () => {
    const entries = extractFromTable(rows, tpl, { date: 0 }, { date: 0.9 }, {
      fileName: 'f.xlsx',
      locator: () => '',
    })
    expect(Object.keys(entries[0].values)).toEqual(['date'])
  })
})

describe('置信度标记', () => {
  it('低置信度字段低于 0.6，供界面高亮', () => {
    const blocks: Block[] = [{ type: 'para', text: '随便写的一段话，没有任何结构。' }]
    const tpl: Template = {
      id: 't4',
      name: 'x',
      description: '',
      builtin: false,
      fields: [{ id: 'summary', name: '摘要', kind: 'text', strategy: 'auto' }],
    }
    const { entries } = extractFromDocument(blocks, tpl, 'a.txt')
    expect(entries[0].confidence.summary).toBeLessThan(0.6)
  })
})
