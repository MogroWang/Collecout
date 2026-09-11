import type { Entry, Library, Template } from '../models'
import { entryTitle, entryImagesOf, formatDate, selectedFields, todayIso, csvEscape, type EntryImageRef, type ExportSelection } from './shared'

export interface ExportTextResult {
  fileName: string
  content: string
}

function headerBlock(template: Template, count: number): string {
  return `> 共 ${count} 条 · 模板：${template.name} · 导出于 ${todayIso()}`
}

/** 文本格式里引用随文导出的图片（相对导出文件的 images/ 目录） */
export const IMAGE_DIR = 'images'

function imagePath(storedAs: string): string {
  return `${IMAGE_DIR}/${storedAs}`
}

function fieldImages(entry: Entry, fields: ReturnType<typeof selectedFields>, fieldId: string): EntryImageRef[] {
  return entryImagesOf(entry, fields).filter((img) => img.fieldId === fieldId)
}

function looseImages(entry: Entry, fields: ReturnType<typeof selectedFields>): EntryImageRef[] {
  return entryImagesOf(entry, fields).filter((img) => !img.fieldId)
}

export function exportMarkdown(library: Library, template: Template, entries: Entry[], selection: ExportSelection): ExportTextResult {
  const fields = selectedFields(template, selection.fields)
  const lines: string[] = [`# ${library.name}`, '', headerBlock(template, entries.length), '']
  entries.forEach((entry, i) => {
    lines.push(`## ${i + 1}. ${entryTitle(entry, template)}`)
    for (const f of fields) {
      const v = entry.values[f.id]
      const imgs = fieldImages(entry, fields, f.id)
      if (v !== undefined && String(v) !== '') {
        const display = f.kind === 'date' ? formatDate(String(v)) : String(v)
        lines.push(`- ${f.name}：${display.replace(/\n/g, '；')}`)
      }
      if (imgs.length > 0) {
        lines.push(`- ${f.name}（图片）：${imgs.map((img) => `![图片](${imagePath(img.storedAs)})`).join(' ')}`)
      }
    }
    const loose = looseImages(entry, fields)
    if (loose.length > 0) {
      lines.push(`- 图片：${loose.map((img) => `![图片](${imagePath(img.storedAs)})`).join(' ')}`)
    }
    lines.push('')
  })
  return { fileName: `${library.name}.md`, content: lines.join('\n') }
}

/** 纯文本排版方式：制表符分隔（表格状）或分节形式（逐条罗列） */
export type TextExportStyle = 'tsv' | 'sections'

/** 单元格文本后附的图片路径标记（tsv / csv / 索引用） */
function pathTag(imgs: EntryImageRef[]): string {
  return imgs.map((img) => `[图片: ${imagePath(img.storedAs)}]`).join('')
}

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
        const imgs = fieldImages(entry, fields, f.id)
        if (v !== undefined && String(v) !== '') {
          const display = f.kind === 'date' ? formatDate(String(v)) : String(v)
          lines.push(`${f.name}：${display.replace(/\n/g, '\n    ')}`)
        }
        for (const img of imgs) lines.push(`${f.name}图片：${imagePath(img.storedAs)}`)
      }
      for (const img of looseImages(entry, fields)) lines.push(`图片：${imagePath(img.storedAs)}`)
      lines.push('')
    })
    return { fileName: `${library.name}.txt`, content: lines.join('\n') }
  }
  const lines: string[] = [fields.map((f) => f.name).join('\t')]
  for (const entry of entries) {
    lines.push(fields.map((f) => {
      const v = entry.values[f.id]
      const imgs = fieldImages(entry, fields, f.id)
      let cell = v === undefined ? '' : f.kind === 'date' ? formatDate(String(v)) : String(v).replace(/[\t\n\r]+/g, ' ')
      cell += pathTag(imgs).replace(/[\t\n\r]+/g, ' ')
      return cell
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
      const imgs = fieldImages(entry, fields, f.id)
      const text = (v === undefined ? '' : f.kind === 'date' ? formatDate(String(v)) : String(v)) + pathTag(imgs)
      return csvEscape(text)
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
      images: entryImagesOf(e, fields).map((img) => ({
        field: img.fieldId ? (fields.find((f) => f.id === img.fieldId)?.name ?? null) : null,
        path: imagePath(img.storedAs),
      })),
      source: e.sourceRef,
    })),
  }
  return { fileName: `${library.name}.json`, content: JSON.stringify(payload, null, 2) }
}
