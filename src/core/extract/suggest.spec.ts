import { describe, expect, it } from 'vitest'
import type { Template } from '../models'
import type { ParsedDoc } from '../parsers/types'
import {
  applyTableLayout,
  inferKindFromSamples,
  inferTemplate,
  looksHeaderLeft,
  mergeFieldsByName,
  nameAffinity,
  suggestColumnMapping,
  transposeGrid,
} from './suggest'

describe('nameAffinity', () => {
  it('完全相等为 1', () => {
    expect(nameAffinity('金额', '金额')).toBe(1)
  })
  it('同义桶为 0.9', () => {
    expect(nameAffinity('日期', '时间')).toBe(0.9)
    expect(nameAffinity('金额', '合计')).toBe(0.9)
    expect(nameAffinity('标题', '名称')).toBe(0.9)
  })
  it('包含关系为 0.75', () => {
    expect(nameAffinity('交易日期', '日期')).toBe(0.75)
    expect(nameAffinity('备注说明', '备注')).toBe(0.75)
  })
  it('无关为 0', () => {
    expect(nameAffinity('备注', '随机词')).toBe(0)
  })
})

describe('suggestColumnMapping', () => {
  const template: Template = {
    id: 't',
    name: 't',
    description: '',
    builtin: false,
    fields: [
      { id: 'date', name: '日期', kind: 'date', strategy: 'tableMap' },
      { id: 'item', name: '项目', kind: 'text', strategy: 'tableMap' },
      { id: 'amount', name: '金额', kind: 'number', strategy: 'tableMap' },
      { id: 'note', name: '备注', kind: 'text', strategy: 'tableMap' },
    ],
  }
  const header = ['交易日期', '事项', '金额（元）', '备注说明']
  const rows = [
    ['2026-08-01', '午餐', '32.5', '工作餐'],
    ['2026-08-02', '打车', '18', '客户拜访'],
  ]
  it('把语义相近的列映射到字段', () => {
    const { mapping, scores } = suggestColumnMapping(header, template, rows)
    expect(mapping.date).toBe(0)
    expect(mapping.item).toBe(1)
    expect(mapping.amount).toBe(2)
    expect(mapping.note).toBe(3)
    expect(scores.amount).toBeGreaterThanOrEqual(0.9)
  })
  it('样本类型与字段类型一致时加分', () => {
    const { scores } = suggestColumnMapping(['交易日期'], template, [['2026-08-01']])
    expect(scores.date).toBeGreaterThan(0.75)
  })
})

describe('inferKindFromSamples', () => {
  it('识别日期列', () => {
    expect(inferKindFromSamples(['2026-08-01', '2026-08-02', '2026/9/3'])).toBe('date')
  })
  it('识别数字列', () => {
    expect(inferKindFromSamples(['32.5', '18', '120', '9'])).toBe('number')
  })
  it('少量重复值识别为标签', () => {
    expect(inferKindFromSamples(['餐饮', '交通', '餐饮', '餐饮'])).toBe('tag')
  })
  it('默认文本', () => {
    expect(inferKindFromSamples([])).toBe('text')
  })
})

describe('inferTemplate 自动识别', () => {
  it('表格主导时按表头生成字段', () => {
    const doc: ParsedDoc = {
      fileName: '流水.xlsx',
      kind: 'xlsx',
      blocks: [
        {
          type: 'table',
          header: ['日期', '项目', '金额'],
          rows: [
            ['2026-08-01', '午餐', '32.5'],
            ['2026-08-02', '打车', '18'],
            ['2026-08-03', '买书', '59'],
          ],
        },
      ],
    }
    const { template, mode, tableIndex } = inferTemplate(doc, 'tpl_auto')
    expect(mode).toBe('table')
    expect(tableIndex).toBe(0)
    expect(template.fields.map((f) => f.name)).toEqual(['日期', '项目', '金额'])
    expect(template.fields[0].kind).toBe('date')
    expect(template.fields[2].kind).toBe('number')
  })
  it('文档模式生成标题/日期/摘要并吸收 key:value', () => {
    const doc: ParsedDoc = {
      fileName: '笔记.txt',
      kind: 'text',
      blocks: [
        { type: 'heading', level: 1, text: '会议记录' },
        { type: 'para', text: '时间：2026年8月28日' },
        { type: 'para', text: '参会人：王明、李华' },
        { type: 'para', text: '正文内容若干，足够长的一段话。' },
      ],
    }
    const { template, mode } = inferTemplate(doc, 'tpl_auto')
    expect(mode).toBe('document')
    const names = template.fields.map((f) => f.name)
    expect(names).toContain('标题')
    expect(names).toContain('日期')
    expect(names).toContain('摘要')
    expect(names).toContain('参会人')
    expect(names).not.toContain('时间')
  })
})

describe('transposeGrid 转置', () => {
  it('第一列变表头，其余列各成一行，短行用空串补齐', () => {
    const { header, rows } = transposeGrid([
      ['姓名', '张三', '李四'],
      ['年龄', '25'],
      ['城市', '北京', '上海'],
    ])
    expect(header).toEqual(['姓名', '年龄', '城市'])
    expect(rows).toEqual([
      ['张三', '25', '北京'],
      ['李四', '', '上海'],
    ])
  })
  it('空表返回空结果', () => {
    expect(transposeGrid([])).toEqual({ header: [], rows: [] })
  })
})

describe('looksHeaderLeft 布局识别', () => {
  it('两列字段-值表判为纵排', () => {
    const grid = [
      ['姓名', '张三'],
      ['年龄', '25'],
      ['城市', '北京'],
      ['邮箱', 'z@example.com'],
    ]
    expect(looksHeaderLeft(grid)).toBe(true)
  })
  it('两列流水（取值列类型一致）判为横排', () => {
    const grid = [
      ['日期', '金额'],
      ['2026-08-01', '32.5'],
      ['2026-08-02', '18'],
      ['2026-08-03', '59'],
    ]
    expect(looksHeaderLeft(grid)).toBe(false)
  })
  it('首列大量留空的普通表判为横排', () => {
    const grid = [
      ['日期', '项目', '金额'],
      ['', '午餐', '32.5'],
      ['', '打车', '18'],
      ['', '买书', '59'],
    ]
    expect(looksHeaderLeft(grid)).toBe(false)
  })
})

describe('applyTableLayout 布局预设', () => {
  const kv = {
    header: ['姓名', '张三'],
    rows: [
      ['年龄', '25'],
      ['城市', '北京'],
      ['邮箱', 'z@example.com'],
    ],
  }
  it('headerLeft 预设强制转置', () => {
    const t = applyTableLayout(kv, 'headerLeft')
    expect(t.layout).toBe('headerLeft')
    expect(t.header).toEqual(['姓名', '年龄', '城市', '邮箱'])
    expect(t.rows).toEqual([['张三', '25', '北京', 'z@example.com']])
  })
  it('auto 对字段-值表选择转置', () => {
    const t = applyTableLayout(kv, 'auto')
    expect(t.layout).toBe('headerLeft')
  })
  it('headerTop 预设原样保留', () => {
    const t = applyTableLayout(kv, 'headerTop')
    expect(t.layout).toBe('headerTop')
    expect(t.header).toEqual(kv.header)
  })
})

describe('mergeFieldsByName 字段合并', () => {
  it('同名字段去重，保留首次出现的定义，新字段追加', () => {
    const merged = mergeFieldsByName([
      [
        { id: 'f_col0', name: '日期', kind: 'date', strategy: 'tableMap' },
        { id: 'f_col1', name: '金额', kind: 'number', strategy: 'tableMap' },
      ],
      [
        { id: 'g_col0', name: '金额', kind: 'text', strategy: 'tableMap' },
        { id: 'g_col1', name: '备注', kind: 'text', strategy: 'tableMap' },
      ],
    ])
    expect(merged.map((f) => f.id)).toEqual(['f_col0', 'f_col1', 'g_col1'])
    expect(merged.map((f) => f.name)).toEqual(['日期', '金额', '备注'])
    expect(merged[1].kind).toBe('number')
  })
  it('空名字段被忽略', () => {
    const merged = mergeFieldsByName([[{ id: 'f_col0', name: '  ', kind: 'text', strategy: 'tableMap' }]])
    expect(merged).toEqual([])
  })
})

describe('inferTemplate 指定工作表与布局', () => {
  it('tableIndex 指定第二张表，auto 布局转置字段-值表', () => {
    const doc: ParsedDoc = {
      fileName: '简历.xlsx',
      kind: 'xlsx',
      blocks: [
        {
          type: 'table',
          header: ['日期', '金额'],
          rows: [
            ['2026-08-01', '32.5'],
            ['2026-08-02', '18'],
            ['2026-08-03', '59'],
          ],
          source: '流水',
        },
        {
          type: 'table',
          header: ['姓名', '张三'],
          rows: [
            ['年龄', '25'],
            ['城市', '北京'],
            ['邮箱', 'z@example.com'],
          ],
          source: '基本信息',
        },
      ],
    }
    const r = inferTemplate(doc, 'tpl_auto', { tableIndex: 1, layout: 'auto' })
    expect(r.mode).toBe('table')
    expect(r.resolvedLayout).toBe('headerLeft')
    expect(r.template?.fields.map((f) => f.name)).toEqual(['姓名', '年龄', '城市', '邮箱'])
    expect(r.table?.rows).toHaveLength(1)
  })
  it('未指定 tableIndex 时保持旧行为：取行数最多的表', () => {
    const doc: ParsedDoc = {
      fileName: '多表.xlsx',
      kind: 'xlsx',
      blocks: [
        { type: 'table', header: ['小', '表'], rows: [['a', 'b']] },
        {
          type: 'table',
          header: ['日期', '项目', '金额'],
          rows: [
            ['2026-08-01', '午餐', '32.5'],
            ['2026-08-02', '打车', '18'],
            ['2026-08-03', '买书', '59'],
          ],
        },
      ],
    }
    const r = inferTemplate(doc, 'tpl_auto')
    expect(r.mode).toBe('table')
    expect(r.tableIndex).toBe(1)
    expect(r.resolvedLayout).toBe('headerTop')
    expect(r.template?.fields.map((f) => f.name)).toEqual(['日期', '项目', '金额'])
  })
})
