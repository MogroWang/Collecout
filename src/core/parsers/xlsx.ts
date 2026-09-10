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
    const [floating, inCell] = await Promise.all([extractSheetImages(data), extractRichValueImages(data)])
    images = [...floating, ...inCell]
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

/** 解析 OOXML 包的公共上下文 */
interface ZipContext {
  entries: Map<string, { name: string; data: Uint8Array }>
  parser: DOMParser
  relsOf: (zipName: string) => Map<string, string>
  resolve: (baseZipName: string, target: string) => string
  /** sheetN.xml 的 zip 名 → 工作表显示名 */
  sheetNames: Map<string, string>
}

async function openZipContext(bytes: Uint8Array): Promise<ZipContext | null> {
  if (typeof DOMParser === 'undefined' || typeof DecompressionStream === 'undefined') return null
  const entriesList = await readZip(bytes)
  const entries = new Map(entriesList.map((e) => [e.name.replace(/^\//, ''), e]))
  const parser = new DOMParser()

  const relsOf = (zipName: string): Map<string, string> => {
    const map = new Map<string, string>()
    const dot = zipName.lastIndexOf('/')
    const relName = zipName.slice(0, dot < 0 ? 0 : dot) + '/_rels/' + zipName.slice(dot + 1) + '.rels'
    const relEntry = entries.get(relName)
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

  // workbook.xml：sheet 显示名 → r:id → worksheets/sheetN.xml
  const sheetNames = new Map<string, string>()
  const wbEntry = entries.get('xl/workbook.xml') ?? entries.get('workbook.xml')
  if (wbEntry) {
    const wbDoc = parser.parseFromString(new TextDecoder().decode(wbEntry.data), 'application/xml')
    const wbRels = relsOf(wbEntry.name)
    for (const sheetTag of tags(wbDoc, 'sheet')) {
      const name = sheetTag.getAttribute('name') ?? ''
      const rid = attrNS(sheetTag, 'id')
      if (!name || !rid) continue
      sheetNames.set(resolve(wbEntry.name, wbRels.get(rid) ?? ''), name)
    }
  }
  return { entries, parser, relsOf, resolve, sheetNames }
}

/** 单元格引用（如 C2）→ 0 起始的 [row, col] */
function parseCellRef(ref: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref.trim())
  if (!m) return null
  let col = 0
  for (const ch of m[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64)
  return { row: Number(m[2]) - 1, col: col - 1 }
}

/**
 * 提取「浮动图片」：workbook → sheet rels（drawing）→
 * drawing XML（twoCellAnchor/oneCellAnchor 的 from 单元格 + blip rId）→ drawing rels → media。
 */
export async function extractSheetImages(bytes: Uint8Array): Promise<ExtractedImage[]> {
  const ctx = await openZipContext(bytes)
  if (!ctx) return []
  const { entries, parser, relsOf, resolve, sheetNames } = ctx

  const images: ExtractedImage[] = []
  for (const [sheetZipName, sheetName] of sheetNames) {
    const sheetRels = relsOf(sheetZipName)
    for (const drawingTarget of sheetRels.values()) {
      if (!/drawing/.test(drawingTarget)) continue
      const drawingName = resolve(sheetZipName, drawingTarget)
      const drawingEntry = entries.get(drawingName)
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
        const media = entries.get(mediaName)
        if (!media) continue
        const baseName = mediaName.split('/').pop() ?? 'image'
        images.push({ name: baseName, bytes: media.data, sheet: sheetName, row, col })
      }
    }
  }
  return images
}

/**
 * 提取「嵌入单元格的图片」（Excel 365 的 Place in Cell / 插入图片到单元格）：
 * sheet 单元格（vm 属性）→ metadata.xml 的 valueMetadata → rdrichvalue.xml（_localImage）→
 * richValueRel.xml 的 rel → richValueRel rels → media。
 */
export async function extractRichValueImages(bytes: Uint8Array): Promise<ExtractedImage[]> {
  const ctx = await openZipContext(bytes)
  if (!ctx) return []
  const { entries, parser, resolve, sheetNames } = ctx
  const dec = new TextDecoder()

  const metaEntry = entries.get('xl/metadata.xml')
  const rvEntry = entries.get('xl/richData/rdrichvalue.xml')
  const relEntry = entries.get('xl/richData/richValueRel.xml')
  if (!metaEntry || !rvEntry || !relEntry) return []

  // valueMetadata：第 N 个 bk 的 rc@v → rich value 索引（vm 属性 1 起始）
  const metaDoc = parser.parseFromString(dec.decode(metaEntry.data), 'application/xml')
  const vmToRv: number[] = tags(metaDoc, 'bk').map((bk) => Number(tags(bk, 'rc')[0]?.getAttribute('v')) || 0)

  // structure 类型过滤：只认首个键以 _rvRel 开头（即引用媒体关系）的 rich value
  const imageStructures = new Set<number>()
  const rsEntry = entries.get('xl/richData/rdrichvaluestructure.xml')
  if (rsEntry) {
    const rsDoc = parser.parseFromString(dec.decode(rsEntry.data), 'application/xml')
    tags(rsDoc, 's').forEach((s, i) => {
      const firstKey = tags(s, 'k')[0]?.getAttribute('n') ?? ''
      if (firstKey.startsWith('_rvRel')) imageStructures.add(i)
    })
  }

  // rich value：s 指向 structure，_rvRel 键的取值 = rel 在 richValueRel 中的索引
  const rvDoc = parser.parseFromString(dec.decode(rvEntry.data), 'application/xml')
  const rvToRel: number[] = []
  for (const rv of tags(rvDoc, 'rv')) {
    const s = Number(rv.getAttribute('s')) || 0
    const isImage = imageStructures.size === 0 ? true : imageStructures.has(s)
    rvToRel.push(isImage ? Number(tags(rv, 'v')[0]?.textContent) || 0 : -1)
  }

  // richValueRel：rel 列表（顺序即索引）→ r:id → rels → media
  const relsDoc = parser.parseFromString(dec.decode(relEntry.data), 'application/xml')
  const relIds = tags(relsDoc, 'rel').map((r) => attrNS(r, 'id') ?? '')
  const relsMap = ctx.relsOf(relEntry.name)

  const relToMedia: (string | null)[] = relIds.map((id) => {
    const target = relsMap.get(id)
    return target ? resolve(relEntry.name, target) : null
  })

  const images: ExtractedImage[] = []
  for (const [sheetZipName, sheetName] of sheetNames) {
    const sheetEntry = entries.get(sheetZipName)
    if (!sheetEntry) continue
    const sheetDoc = parser.parseFromString(dec.decode(sheetEntry.data), 'application/xml')
    for (const cell of tags(sheetDoc, 'c')) {
      const vm = cell.getAttribute('vm')
      if (!vm) continue
      const rvIndex = vmToRv[Number(vm) - 1]
      const relIndex = rvToRel[rvIndex]
      const mediaName = relToMedia[relIndex]
      if (!mediaName) continue
      const media = entries.get(mediaName)
      if (!media) continue
      const ref = parseCellRef(cell.getAttribute('r') ?? '')
      if (!ref) continue
      images.push({
        name: mediaName.split('/').pop() ?? 'image',
        bytes: media.data,
        sheet: sheetName,
        row: ref.row,
        col: ref.col,
      })
    }
  }
  return images
}
