import { describe, expect, it } from 'vitest'
import type { Entry, Library, Template } from '../models'
import { exportCsv, exportJson, exportMarkdown, exportPlainText } from './text'
import { exportFolderPlan, sanitizeFileName } from './folder'

const template: Template = {
  id: 'tpl',
  name: '会议纪要',
  description: '',
  builtin: false,
  fields: [
    { id: 'title', name: '主题', kind: 'text', strategy: 'auto' },
    { id: 'date', name: '日期', kind: 'date', strategy: 'auto' },
    { id: 'amount', name: '金额', kind: 'number', strategy: 'auto' },
  ],
}

function entry(values: Record<string, string | number>): Entry {
  return {
    id: `e${Math.random()}`,
    libraryId: 'lib',
    values,
    confidence: {},
    sourceRef: { fileName: '来源.docx', locator: '全文' },
    createdAt: '',
    updatedAt: '',
  }
}

const library: Library = {
  id: 'lib',
  name: '项目资料',
  templateId: 'tpl',
  sources: [],
  entries: [],
  createdAt: '',
  updatedAt: '',
}

const entries = [
  entry({ title: '八月周会', date: '2026-08-28', amount: 100 }),
  entry({ title: '九月启动会', date: '2026-09-09', amount: 0 }),
]

describe('文本导出', () => {
  it('Markdown 生成文档标题与条目分节', () => {
    const { content } = exportMarkdown(library, template, entries, { fields: ['title', 'date', 'amount'] })
    expect(content).toContain('# 项目资料')
    expect(content).toContain('## 1. 八月周会')
    expect(content).toContain('- 日期：2026-08-28')
    expect(content).toContain('- 金额：100')
  })
  it('纯文本首行为表头、制表符分隔', () => {
    const { content } = exportPlainText(library, template, entries, { fields: ['title', 'date'] })
    const lines = content.split('\n')
    expect(lines[0]).toBe('主题\t日期')
    expect(lines[1]).toBe('八月周会\t2026-08-28')
  })
  it('CSV 转义逗号、引号与换行，并带 BOM', () => {
    const weird = [entry({ title: '含,逗号', date: '2026-01-01', amount: 0 }), entry({ title: '含"引号"', date: '2026-01-02', amount: 0 })]
    const { content } = exportCsv(library, template, weird, { fields: ['title'] })
    expect(content.startsWith('\uFEFF')).toBe(true)
    const rows = content.slice(1).split('\n')
    expect(rows[1]).toContain('"含,逗号"')
    expect(rows[2]).toContain('""引号""')
  })
  it('JSON 可解析且保留所选字段', () => {
    const { content } = exportJson(library, template, entries, { fields: ['title', 'amount'] })
    const parsed = JSON.parse(content)
    expect(parsed.library.name).toBe('项目资料')
    expect(parsed.entries[0].values.title).toBe('八月周会')
    expect(parsed.entries[0].values.date).toBeUndefined()
  })
})

describe('文件夹导出方案', () => {
  it('每个条目一个文件 + 索引', () => {
    const plan = exportFolderPlan(library, template, entries, { fields: ['title', 'date', 'amount'] })
    const names = Object.keys(plan.files)
    expect(names).toHaveLength(3)
    expect(names[0]).toBe('0001_八月周会.md')
    expect(names[2]).toBe('索引.md')
    expect(plan.files['0001_八月周会.md']).toContain('---')
    expect(plan.files['0001_八月周会.md']).toContain('主题: 八月周会')
    expect(plan.files['索引.md']).toContain('| 1 | 八月周会')
  })
  it('重名条目自动加序号', () => {
    const dup = [entry({ title: '同名' }), entry({ title: '同名' })]
    const plan = exportFolderPlan(library, template, dup, { fields: ['title'] })
    const names = Object.keys(plan.files)
    expect(names[0]).toBe('0001_同名.md')
    expect(names[1]).toBe('0002_同名（2）.md')
  })
  it('文件名清洗非法字符', () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
    expect(sanitizeFileName('')).toBe('未命名')
  })
})
