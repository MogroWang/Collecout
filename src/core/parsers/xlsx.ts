import * as XLSX from 'xlsx'
import type { Block, ParsedDoc } from './types'
import { readZip } from './zip'

/** 从 xlsx 单元格锚点提取的图片 */
export interface ExtractedImage {
  /** 媒体文件原名（image1.png 等） */
  name: string
  bytes: Uint8Array
  /** 工作表显示名 */
  sheet: string
  /** 锚定单元格（0 起始的列/行，twoCellAnchor 取左上角） */
  row: number
  col: number
}

/** Excel / CSV 解析：每个 sheet 生成一个表格块，首行为表头；同时提取单元格图片 */
export async function parseSheet(data: Uint8Array, fileName: string): Promise<ParsedDoc> {
  const wb = XLSX.read(data, { type: 'array', raw: false })
  const blocks: Block[] = []
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name], {
      header: 1,
      blankrows: false,
      raw: false,
      defval: '',
    })
    if (rows.length === 0) continue
    const width = Math.max(...rows.map((r) => r.length))
    const pad = (r: unknown[]) => {
      const cells = (r as unknown[]).map((c) => String(c ?? '').trim())
      return cells.length < width ? [...cells, ...Array(width - cells.length).fill('')] : cells
    }
    const [head, ...body] = rows.map(pad)
    if (!head || head.every((c) => c === '')) continue
    // 末行若整行为空则丢弃
    while (body.length > 0 && body[body.length - 1].every((c) => c === '')) body.pop()
    blocks.push({ type: 'table', header: head, rows: body, source: name })
  }
  let images: ExtractedImage[] = []
  try {
    images = await extractSheetImages(data)
  } catch {
    /* 图片提取失败不影响表格内容导入 */
  }
  return { fileName, kind: 'xlsx', blocks, images }
}

function textOf(el: Element | null | undefined): string {
  return el?.textContent ?? ''
}

/** OOXML 的标签带命名空间前缀（xdr:、a: 等），统一按 localName 匹配。
 *  不用 getElementsByTagNameNS：部分运行时（happy-dom）对通配命名空间的实现不可靠。 */
function tags(root: Element | Document, localName: string): Element[] {
  const target = localName.toLowerCase()
  const out: Element[] = []
  for (const el of Array.from(root.getElementsByTagName('*'))) {
    if ((el.localName ?? '').toLowerCase() === target) out.push(el)
  }
  return out
}

/** 读「带前缀属性」（r:id、r:embed）：按 localName 找，规避各运行时对前缀属性的差异 */
function attrNS(el: Element, localName: string): string | null {
  for (const a of Array.from(el.attributes)) {
    const ln = (a.localName ?? a.name).toLowerCase()
    if (ln === localName || a.name.toLowerCase() === localName || a.name.toLowerCase().endsWith(':' + localName)) {
      return a.value
    }
  }
  return null
}

/**
 * 提取 xlsx 内嵌图片：
 * workbook.xml（sheet 名）→ workbook rels（sheetN.xml）→ sheet rels（drawing）→
 * drawing XML（twoCellAnchor/oneCellAnchor 的 from 单元格 + blip rId）→ drawing rels → media。
 */
export async function extractSheetImages(bytes: Uint8Array): Promise<ExtractedImage[]> {
  if (typeof DOMParser === 'undefined' || typeof DecompressionStream === 'undefined') return []
  const entries = await readZip(bytes)
  const byName = new Map(entries.map((e) => [e.name.replace(/^\//, ''), e]))
  const parser = new DOMParser()

  const relsOf = (zipName: string): Map<string, string> => {
    const map = new Map<string, string>()
    const dot = zipName.lastIndexOf('/')
    const relName = zipName.slice(0, dot < 0 ? 0 : dot) + '/_rels/' + zipName.slice(dot + 1) + '.rels'
    const relEntry = byName.get(relName)
    if (!relEntry) return map
    const doc = parser.parseFromString(new TextDecoder().decode(relEntry.data), 'application/xml')
    for (const rel of tags(doc, 'Relationship')) {
      const id = rel.getAttribute('Id')
      const target = rel.getAttribute('Target') ?? ''
      if (id) map.set(id, target)
    }
    return map
  }

  const resolve = (baseZipName: string, target: string): string => {
    if (target.startsWith('/')) return target.slice(1)
    const dir = baseZipName.includes('/') ? baseZipName.slice(0, baseZipName.lastIndexOf('/') + 1) : ''
    // 规整 a/../b 与 ./a
    const parts: string[] = []
    for (const seg of (dir + target).split('/')) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') parts.pop()
      else parts.push(seg)
    }
    return parts.join('/')
  }

  // workbook.xml：sheet 显示名 → r:id；workbook rels：r:id → worksheets/sheetN.xml
  const wbEntry = byName.get('xl/workbook.xml') ?? byName.get('workbook.xml')
  if (!wbEntry) return []
  const wbDoc = parser.parseFromString(new TextDecoder().decode(wbEntry.data), 'application/xml')
  const wbRels = relsOf(wbEntry.name)

  const images: ExtractedImage[] = []
  const sheetTags = tags(wbDoc, 'sheet')
  for (const sheetTag of sheetTags) {
    const sheetName = sheetTag.getAttribute('name') ?? ''
    const rid = attrNS(sheetTag, 'id')
    if (!rid) continue
    const sheetZipName = resolve(wbEntry.name, wbRels.get(rid) ?? '')
    const sheetRels = relsOf(sheetZipName)
    for (const drawingTarget of sheetRels.values()) {
      if (!/drawing/.test(drawingTarget)) continue
      const drawingName = resolve(sheetZipName, drawingTarget)
      const drawingEntry = byName.get(drawingName)
      if (!drawingEntry) continue
      const drawingRels = relsOf(drawingName)
      const dDoc = parser.parseFromString(new TextDecoder().decode(drawingEntry.data), 'application/xml')
      for (const anchor of tags(dDoc, 'twoCellAnchor').concat(tags(dDoc, 'oneCellAnchor'))) {
        const from = tags(anchor, 'from')[0]
        if (!from) continue
        const col = Number(textOf(tags(from, 'col')[0])) || 0
        const row = Number(textOf(tags(from, 'row')[0])) || 0
        const blip = tags(anchor, 'blip')[0]
        const embed = blip ? attrNS(blip, 'embed') : null
        if (!embed) continue
        const mediaTarget = drawingRels.get(embed)
        if (!mediaTarget) continue
        const mediaName = resolve(drawingName, mediaTarget)
        const media = byName.get(mediaName)
        if (!media) continue
        const baseName = mediaName.split('/').pop() ?? 'image'
        images.push({ name: baseName, bytes: media.data, sheet: sheetName, row, col })
      }
    }
  }
  return images
}
