import type { Entry, Library, Template } from '../models'
import { entryImagesOf, entryTitle, formatDate, selectedFields, todayIso, type EntryImageRef, type ExportSelection } from './shared'
import { imageExtOf } from '../image'

export interface FolderPlan {
  dirName: string
  files: Record<string, string>
  /** 随文本一起落盘的图片原文件：相对路径 → 字节 */
  binaries: Record<string, Uint8Array>
  indexJson: string
}

/** 图片在导出文件夹里的组织方式：row 按条目分行（图片随条目文件夹），column 按字段分列（图片收进字段文件夹） */
export type FolderImageLayout = 'row' | 'column'

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\n\r\t]/g, '-').replace(/\s+/g, ' ').trim()
  return (cleaned || '未命名').slice(0, 80)
}

/** 图片原文件名（storedAs 只是存储名，尽量还原导入时的名字） */
function originalImageName(storedAs: string, nameOf?: Map<string, string>): string {
  const original = nameOf?.get(storedAs)
  const safe = sanitizeFileName(original ?? storedAs)
  return safe.includes('.') ? safe : `${safe}.${imageExtOf(storedAs)}`
}

/** 同名图片自动加序号 */
class NameAllocator {
  private used = new Set<string>()

  allocate(wanted: string): string {
    const dot = wanted.lastIndexOf('.')
    const stem = dot > 0 ? wanted.slice(0, dot) : wanted
    const ext = dot > 0 ? wanted.slice(dot) : ''
    let candidate = wanted
    for (let n = 2; this.used.has(candidate); n++) candidate = `${stem}（${n}）${ext}`
    this.used.add(candidate)
    return candidate
  }
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

/** 条目文件里的图片引用：md 用 ![]() 语法，txt 写路径 */
function imageLines(entry: Entry, fields: ReturnType<typeof selectedFields>, pathOf: (img: EntryImageRef) => string, textExt: 'md' | 'txt'): string[] {
  const lines: string[] = []
  for (const f of fields) {
    const imgs = entryImagesOf(entry, fields).filter((img) => img.fieldId === f.id)
    if (imgs.length === 0) continue
    if (textExt === 'md') {
      lines.push(`**${f.name}图片**：${imgs.map((img) => `![图片](${pathOf(img)})`).join(' ')}`)
    } else {
      lines.push(`${f.name}图片：${imgs.map((img) => pathOf(img)).join('、')}`)
    }
  }
  const loose = entryImagesOf(entry, fields).filter((img) => !img.fieldId)
  if (loose.length > 0) {
    if (textExt === 'md') {
      lines.push(`**图片**：${loose.map((img) => `![图片](${pathOf(img)})`).join(' ')}`)
    } else {
      lines.push(`图片：${loose.map((img) => pathOf(img)).join('、')}`)
    }
  }
  return lines
}

/**
 * 文件夹导出方案：每个条目一个文件 + 索引。
 * textExt = 'md' 输出 Markdown（front matter + 索引表）；'txt' 输出纯文本分节。
 * imageLayout 决定图片原文件的组织：row = 每个条目一个文件夹；column = 每个字段一个文件夹。
 * imageBytes：storedAs → 字节 + 原始文件名（nameOf），提供时输出图片原文件而非链接。
 */
export function exportFolderPlan(
  library: Library,
  template: Template,
  entries: Entry[],
  selection: ExportSelection,
  textExt: 'md' | 'txt' = 'md',
  imageLayout: FolderImageLayout = 'row',
  binaries?: { bytes: Map<string, Uint8Array>; nameOf?: Map<string, string> },
): FolderPlan {
  const fields = selectedFields(template, selection.fields)
  const bodyField = template.fields.find((f) => f.kind === 'text' && /内容|摘要|正文|记录|note|content/i.test(f.name) && fields.includes(f))
  const files: Record<string, string> = {}
  const out: Record<string, Uint8Array> = {}
  const fileNames: string[] = []
  const usedNames = new Set<string>()

  // 预分配条目文件名（图片路径要引用它们所在的文件夹）
  const entryDirs: string[] = []
  entries.forEach((entry, i) => {
    const num = String(i + 1).padStart(4, '0')
    let base = sanitizeFileName(entryTitle(entry, template))
    let name = `${base}.${textExt}`
    for (let n = 2; usedNames.has(name); n++) name = `${base}（${n}）.${textExt}`
    usedNames.add(name)
    fileNames.push(`${num}_${name}`)
    entryDirs.push(`${num}_${sanitizeFileName(entryTitle(entry, template))}`)
  })

  // 图片原文件路径：每张图在本次导出中只分配一次（entryIndex + storedAs + 字段定位）
  const allocators = { shared: new NameAllocator() }
  const relOf = new Map<string, string>()
  const relKey = (entryIndex: number, img: EntryImageRef) => `${entryIndex}|${img.fieldId ?? ''}|${img.storedAs}`
  const pathOf = (entryIndex: number, img: EntryImageRef): string | null => {
    if (!binaries?.bytes.has(img.storedAs)) return null
    const key = relKey(entryIndex, img)
    const memo = relOf.get(key)
    if (memo) return memo
    const dir = imageLayout === 'row' ? entryDirs[entryIndex] : img.fieldId ? sanitizeFileName(fields.find((f) => f.id === img.fieldId)?.name ?? '图片') : '图片'
    const rel = allocators.shared.allocate(`${dir}/${originalImageName(img.storedAs, binaries.nameOf)}`)
    relOf.set(key, rel)
    return rel
  }

  entries.forEach((entry, i) => {
    const fileName = fileNames[i]
    // 相对条目文件自身的图片引用：row 模式图片就在同级文件夹里，column 模式从根算起
    const refOf = (img: EntryImageRef): string => {
      const rel = pathOf(i, img)
      if (!rel) return img.storedAs
      if (imageLayout === 'row') return rel.slice(rel.indexOf('/') + 1)
      return `../${rel}`
    }
    if (textExt === 'md') {
      const meta = frontMatter(entry, fields)
      const body = bodyField ? String(entry.values[bodyField.id] ?? '') : ''
      const bodyRest = fields
        .filter((f) => f !== bodyField)
        .filter((f) => entry.values[f.id] !== undefined && String(entry.values[f.id]) !== '')
        .map((f) => `- **${f.name}**：${f.kind === 'date' ? formatDate(String(entry.values[f.id])) : String(entry.values[f.id]).replace(/\n/g, '；')}`)
      const imgs = imageLines(entry, fields, refOf, 'md')
      files[fileName] = [meta, '', body !== '' ? body : bodyRest.join('\n'), ...(imgs.length > 0 ? ['', ...imgs] : [])].join('\n').trimEnd() + '\n'
    } else {
      const imgs = imageLines(entry, fields, refOf, 'txt')
      files[fileName] = [plainEntry(entry, fields, bodyField), ...imgs].join('\n') + '\n'
    }
    // 登记图片原文件字节
    for (const img of entryImagesOf(entry, fields)) {
      const rel = pathOf(i, img)
      const bytes = rel ? binaries?.bytes.get(img.storedAs) : null
      if (rel && bytes) out[rel] = bytes
    }
  })

  const indexTitle = `# ${library.name} · 索引`
  if (textExt === 'md') {
    const indexLines = [
      indexTitle,
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
    binaries: out,
    indexJson: JSON.stringify(
      {
        app: '萃序 Collecout',
        version: 2,
        exportedAt: new Date().toISOString(),
        library: { id: library.id, name: library.name },
        template: { id: template.id, name: template.name },
        imageLayout,
        files: Object.keys(files),
        images: Object.keys(out),
      },
      null,
      2,
    ),
  }
}
