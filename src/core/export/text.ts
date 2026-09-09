import type { Entry, Library, Template } from '../models'
import { entryTitle, formatDate, selectedFields, todayIso, csvEscape, type ExportSelection } from './shared'

export interface ExportTextResult {
  fileName: string
  content: string
}

function headerBlock(template: Template, count: number): string {
  return `> 共 ${count} 条 · 模板：${template.name} · 导出于 ${todayIso()}`
}

export function exportMarkdown(library: Library, template: Template, entries: Entry[], selection: ExportSelection): ExportTextResult {
  const fields = selectedFields(template, selection.fields)
  const lines: string[] = [`# ${library.name}`, '', headerBlock(template, entries.length), '']
  entries.forEach((entry, i) => {
    lines.push(`## ${i + 1}. ${entryTitle(entry, template)}`)
    for (const f of fields) {
      const v = entry.values[f.id]
      if (v === undefined || String(v) === '') continue
      const display = f.kind === 'date' ? formatDate(String(v)) : String(v)
      lines.push(`- ${f.name}：${display.replace(/\n/g, '；')}`)
    }
    lines.push('')
  })
  return { fileName: `${library.name}.md`, content: lines.join('\n') }
}

/** 纯文本排版方式：制表符分隔（表格状）或分节形式（逐条罗列） */
export type TextExportStyle = 'tsv' | 'sections'

/** 纯文本。tsv：首行表头 + 制表符分隔，方便粘贴到表格；sections：每条一个小节，逐字段罗列 */
export function exportPlainText(
  library: Library,
  template: Template,
  entries: Entry[],
  selection: ExportSelection,
  style: TextExportStyle = 'tsv',
): ExportTextResult {
  const fields = selectedFields(template, selection.fields)
  if (style === 'sections') {
    const lines: string[] = [`${library.name}`, headerBlock(template, entries.length), '']
    entries.forEach((entry, i) => {
      lines.push(`────────────────────────`)
      lines.push(`${i + 1}. ${entryTitle(entry, template)}`)
      lines.push(`────────────────────────`)
      for (const f of fields) {
        const v = entry.values[f.id]
        if (v === undefined || String(v) === '') continue
        const display = f.kind === 'date' ? formatDate(String(v)) : String(v)
        lines.push(`${f.name}：${display.replace(/\n/g, '\n    ')}`)
      }
      lines.push('')
    })
    return { fileName: `${library.name}.txt`, content: lines.join('\n') }
  }
  const lines: string[] = [fields.map((f) => f.name).join('\t')]
  for (const entry of entries) {
    lines.push(fields.map((f) => {
      const v = entry.values[f.id]
      if (v === undefined) return ''
      return f.kind === 'date' ? formatDate(String(v)) : String(v).replace(/[\t\n\r]+/g, ' ')
    }).join('\t'))
  }
  return { fileName: `${library.name}.txt`, content: lines.join('\n') }
}

export function exportCsv(library: Library, template: Template, entries: Entry[], selection: ExportSelection): ExportTextResult {
  const fields = selectedFields(template, selection.fields)
  const lines: string[] = [fields.map((f) => csvEscape(f.name)).join(',')]
  for (const entry of entries) {
    lines.push(fields.map((f) => {
      const v = entry.values[f.id]
      if (v === undefined) return ''
      return csvEscape(f.kind === 'date' ? formatDate(String(v)) : String(v))
    }).join(','))
  }
  // BOM 让 Excel 直接打开时正确识别 UTF-8
  return { fileName: `${library.name}.csv`, content: '\uFEFF' + lines.join('\n') }
}

export function exportJson(library: Library, template: Template, entries: Entry[], selection: ExportSelection): ExportTextResult {
  const fields = selectedFields(template, selection.fields)
  const payload = {
    app: '萃序 Collecout',
    version: 1,
    exportedAt: new Date().toISOString(),
    library: { id: library.id, name: library.name },
    template: { id: template.id, name: template.name },
    fields: fields.map((f) => ({ id: f.id, name: f.name, kind: f.kind })),
    entries: entries.map((e) => ({
      title: entryTitle(e, template),
      values: Object.fromEntries(fields.map((f) => [f.id, e.values[f.id] ?? null])),
      source: e.sourceRef,
    })),
  }
  return { fileName: `${library.name}.json`, content: JSON.stringify(payload, null, 2) }
}
