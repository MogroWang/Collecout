import type { Entry, Library, Template } from '../models'
import { entryTitle, formatDate, selectedFields, todayIso, type ExportSelection } from './shared'

export interface FolderPlan {
  dirName: string
  files: Record<string, string>
  indexJson: string
}

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\n\r\t]/g, '-').replace(/\s+/g, ' ').trim()
  return (cleaned || '未命名').slice(0, 80)
}

function frontMatter(entry: Entry, fields: ReturnType<typeof selectedFields>): string {
  const lines: string[] = ['---']
  for (const f of fields) {
    const v = entry.values[f.id]
    lines.push(`${f.name}: ${v === undefined ? '' : f.kind === 'date' ? formatDate(String(v)) : String(v).replace(/\n/g, '；')}`)
  }
  lines.push(`来源: ${entry.sourceRef.fileName} ${entry.sourceRef.locator}`)
  lines.push('---')
  return lines.join('\n')
}

function plainEntry(entry: Entry, fields: ReturnType<typeof selectedFields>, bodyField: Template['fields'][number] | undefined): string {
  const lines: string[] = []
  for (const f of fields) {
    const v = entry.values[f.id]
    if (v === undefined || String(v) === '') continue
    const value = f.kind === 'date' ? formatDate(String(v)) : String(v)
    if (f === bodyField && value.includes('\n')) {
      lines.push(`${f.name}:`)
      lines.push(value)
    } else {
      lines.push(`${f.name}: ${value.replace(/\n/g, '；')}`)
    }
  }
  lines.push(`来源: ${entry.sourceRef.fileName} ${entry.sourceRef.locator}`)
  return lines.join('\n')
}

/**
 * 文件夹导出方案：每个条目一个文件 + 索引。
 * textExt = 'md' 输出 Markdown（front matter + 索引表）；'txt' 输出纯文本分节。
 */
export function exportFolderPlan(
  library: Library,
  template: Template,
  entries: Entry[],
  selection: ExportSelection,
  textExt: 'md' | 'txt' = 'md',
): FolderPlan {
  const fields = selectedFields(template, selection.fields)
  const bodyField = template.fields.find((f) => f.kind === 'text' && /内容|摘要|正文|记录|note|content/i.test(f.name) && fields.includes(f))
  const files: Record<string, string> = {}
  const fileNames: string[] = []
  const usedNames = new Set<string>()
  entries.forEach((entry, i) => {
    const num = String(i + 1).padStart(4, '0')
    let base = sanitizeFileName(entryTitle(entry, template))
    let name = `${base}.${textExt}`
    for (let n = 2; usedNames.has(name); n++) name = `${base}（${n}）.${textExt}`
    usedNames.add(name)
    fileNames.push(`${num}_${name}`)
    if (textExt === 'md') {
      const meta = frontMatter(entry, fields)
      const body = bodyField ? String(entry.values[bodyField.id] ?? '') : ''
      const bodyRest = fields
        .filter((f) => f !== bodyField)
        .filter((f) => entry.values[f.id] !== undefined && String(entry.values[f.id]) !== '')
        .map((f) => `- **${f.name}**：${f.kind === 'date' ? formatDate(String(entry.values[f.id])) : String(entry.values[f.id]).replace(/\n/g, '；')}`)
      files[`${num}_${name}`] = [meta, '', body !== '' ? body : bodyRest.join('\n')].join('\n').trimEnd() + '\n'
    } else {
      files[`${num}_${name}`] = plainEntry(entry, fields, bodyField) + '\n'
    }
  })

  if (textExt === 'md') {
    const indexLines = [
      `# ${library.name} · 索引`,
      '',
      `共 ${entries.length} 条 · 模板：${template.name} · 导出于 ${todayIso()}`,
      '',
      '| # | ' + fields.map((f) => f.name).join(' | ') + ' | 文件 |',
      '| --- | ' + fields.map(() => '---').join(' | ') + ' | --- |',
    ]
    entries.forEach((entry, i) => {
      const cells = fields.map((f) => {
        const v = entry.values[f.id]
        return v === undefined ? '' : String(v).replace(/\|/g, '\\|').replace(/\n/g, '；')
      })
      indexLines.push(`| ${i + 1} | ${cells.join(' | ')} | ${fileNames[i]} |`)
    })
    files['索引.md'] = indexLines.join('\n') + '\n'
  } else {
    const indexLines = [
      `${library.name} · 索引`,
      `共 ${entries.length} 条 · 模板：${template.name} · 导出于 ${todayIso()}`,
      '',
      ...entries.map((entry, i) => {
        const cells = fields.map((f) => {
          const v = entry.values[f.id]
          return v === undefined ? '' : String(v).replace(/\t|\n/g, '；')
        })
        return `${i + 1}\t${cells.join('\t')}\t${fileNames[i]}`
      }),
    ]
    files['索引.txt'] = indexLines.join('\n') + '\n'
  }

  return {
    dirName: sanitizeFileName(`${library.name} 导出 ${todayIso()}`),
    files,
    indexJson: JSON.stringify(
      {
        app: '萃序 Collecout',
        version: 1,
        exportedAt: new Date().toISOString(),
        library: { id: library.id, name: library.name },
        template: { id: template.id, name: template.name },
        files: Object.keys(files),
      },
      null,
      2,
    ),
  }
}
