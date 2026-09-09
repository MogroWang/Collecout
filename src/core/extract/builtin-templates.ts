import type { Template } from '../models'

let seq = 0
function fid(name: string): string {
  return `bf_${seq++}_${name}`
}

export const BUILTIN_TEMPLATES: Template[] = [
  {
    id: 'tpl_meeting',
    name: '会议纪要',
    description: '从会议记录里提取主题、时间、参会人、决议与待办。',
    builtin: true,
    fields: [
      { id: fid('title'), name: '主题', kind: 'text', strategy: 'auto' },
      { id: fid('date'), name: '日期', kind: 'date', strategy: 'auto' },
      { id: fid('people'), name: '参会人', kind: 'text', strategy: 'keyword' },
      { id: fid('location'), name: '地点', kind: 'text', strategy: 'keyword' },
      { id: fid('decision'), name: '决议', kind: 'text', strategy: 'heading' },
      { id: fid('todo'), name: '待办', kind: 'text', strategy: 'heading' },
      { id: fid('note'), name: '备注', kind: 'text', strategy: 'auto' },
    ],
  },
  {
    id: 'tpl_reading',
    name: '读书笔记',
    description: '整理书名、作者、评分与摘录，适合批量归档读书摘要。',
    builtin: true,
    fields: [
      { id: fid('title'), name: '书名', kind: 'text', strategy: 'auto' },
      { id: fid('author'), name: '作者', kind: 'text', strategy: 'keyword' },
      { id: fid('date'), name: '日期', kind: 'date', strategy: 'auto' },
      { id: fid('tag'), name: '类型', kind: 'tag', strategy: 'keyword' },
      { id: fid('score'), name: '评分', kind: 'number', strategy: 'keyword' },
      { id: fid('summary'), name: '摘要', kind: 'text', strategy: 'auto' },
      { id: fid('excerpt'), name: '摘录', kind: 'text', strategy: 'heading' },
    ],
  },
  {
    id: 'tpl_ledger',
    name: '收支流水',
    description: '面向 Excel 流水表：日期、项目、类别、金额与收支方向。',
    builtin: true,
    fields: [
      { id: fid('date'), name: '日期', kind: 'date', strategy: 'tableMap' },
      { id: fid('item'), name: '项目', kind: 'text', strategy: 'tableMap' },
      { id: fid('tag'), name: '类别', kind: 'tag', strategy: 'tableMap' },
      { id: fid('amount'), name: '金额', kind: 'number', strategy: 'tableMap' },
      { id: fid('io'), name: '收支', kind: 'tag', strategy: 'tableMap' },
      { id: fid('note'), name: '备注', kind: 'text', strategy: 'tableMap' },
    ],
  },
  {
    id: 'tpl_generic',
    name: '通用表格',
    description: '适合任意带表头的 Excel / CSV：标题、日期、类别、数量、备注。',
    builtin: true,
    fields: [
      { id: fid('title'), name: '标题', kind: 'text', strategy: 'tableMap' },
      { id: fid('date'), name: '日期', kind: 'date', strategy: 'tableMap' },
      { id: fid('tag'), name: '类别', kind: 'tag', strategy: 'tableMap' },
      { id: fid('amount'), name: '数量', kind: 'number', strategy: 'tableMap' },
      { id: fid('note'), name: '备注', kind: 'text', strategy: 'tableMap' },
    ],
  },
  {
    id: 'tpl_auto',
    name: '自动识别',
    description: '分析文档结构，自动推断字段与提取方式，不预定义任何列。',
    builtin: true,
    fields: [],
  },
]
