import type { Entry, Library, Template } from '../models'
import { entryImagesOf, formatDate, selectedFields, type ExportSelection } from './shared'
import { zipStore } from './docx'
import { imageExtOf, readImageSize } from '../image'

/**
 * Excel（.xlsx）导出：一行一条，零依赖手写 OOXML（stored ZIP）。
 * 条目图片（bytesOf 提供字节）以 oneCellAnchor 锚定在其字段单元格上，随表格一并嵌入。
 */

const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** 0 起始列号 → A/B/…/AA 列名 */
function colName(index: number): string {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    out = String.fromCharCode(65 + rem) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
}

function inlineStr(ref: string, text: string, style?: number): string {
  const s = style !== undefined ? ` s="${style}"` : ''
  return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`
}

function numberCell(ref: string, value: number, style?: number): string {
  const s = style !== undefined ? ` s="${style}"` : ''
  return `<c r="${ref}"${s}><v>${value}</v></c>`
}

/** xlsx 可嵌入的图片类型（webp 不被 Excel 支持，跳过） */
const XLSX_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp'])

interface MediaItem {
  storedAs: string
  zipName: string
  rid: string
  ext: string
  bytes: Uint8Array
  wPx: number
  hPx: number
}

/** 收集去重后的图片媒体，并换算成嵌入尺寸（高约 64px，保持纵横比） */
function collectMedia(entries: Entry[], fields: ReturnType<typeof selectedFields>, bytesOf: Map<string, Uint8Array> | undefined): MediaItem[] {
  if (!bytesOf) return []
  const media: MediaItem[] = []
  const byStored = new Map<string, MediaItem>()
  const used = new Set<string>()
  for (const entry of entries) {
    for (const img of entryImagesOf(entry, fields)) {
      if (used.has(img.storedAs)) continue
      used.add(img.storedAs)
      const bytes = bytesOf.get(img.storedAs)
      if (!bytes) continue
      const ext = imageExtOf(img.storedAs)
      if (!XLSX_IMAGE_EXTS.has(ext)) continue
      const existing = byStored.get(img.storedAs)
      if (existing) continue
      const size = readImageSize(bytes) ?? { w: 160, h: 120 }
      const scale = Math.min(64 / size.h, 1)
      const item: MediaItem = {
        storedAs: img.storedAs,
        zipName: `xl/media/${media.length + 1}_${img.storedAs.replace(/\\/g, '_')}`,
        rid: '',
        ext: ext === 'jpg' ? 'jpeg' : ext,
        bytes,
        wPx: Math.max(1, Math.round(size.w * scale)),
        hPx: Math.max(1, Math.round(size.h * scale)),
      }
      byStored.set(img.storedAs, item)
      media.push(item)
    }
  }
  media.forEach((m, i) => (m.rid = `rIdImg${i + 1}`))
  return media
}

/** 图片所在列（0 起始）：字段列；条目级图片放最末尾的「图片」列 */
function imageAnchorCols(entries: Entry[], fields: ReturnType<typeof selectedFields>, looseCol: number): { entryIndex: number; storedAs: string; col: number }[] {
  const out: { entryIndex: number; storedAs: string; col: number }[] = []
  entries.forEach((entry, entryIndex) => {
    for (const img of entryImagesOf(entry, fields)) {
      if (img.fieldId) {
        const col = fields.findIndex((f) => f.id === img.fieldId)
        if (col >= 0) {
          out.push({ entryIndex, storedAs: img.storedAs, col })
          continue
        }
      }
      out.push({ entryIndex, storedAs: img.storedAs, col: looseCol })
    }
  })
  return out
}

/** 条目导出为 .xlsx；bytesOf（storedAs → 字节）提供时嵌入单元格图片 */
export function exportXlsxBytes(
  library: Library,
  template: Template,
  entries: Entry[],
  selection: ExportSelection,
  bytesOf?: Map<string, Uint8Array>,
): Uint8Array {
  const enc = new TextEncoder()
  const fields = selectedFields(template, selection.fields)
  const media = collectMedia(entries, fields, bytesOf)

  // 「图片」列：仅当存在无字段归属（或字段已不在所选范围）的图片时追加
  const hasLoose = entries.some((e) => entryImagesOf(e, fields).some((img) => !img.fieldId || !fields.some((f) => f.id === img.fieldId)))

  // ---------- sheet1 ----------
  const headerRow = fields.map((f, i) => inlineStr(`${colName(i)}1`, f.name, 1))
  if (hasLoose) headerRow.push(inlineStr(`${colName(fields.length)}1`, '图片', 1))

  const dataRows: string[] = []
  entries.forEach((entry, ei) => {
    const rowNo = ei + 2
    const cells: string[] = []
    fields.forEach((f, ci) => {
      const v = entry.values[f.id]
      if (v === undefined || String(v) === '') {
        cells.push('')
        return
      }
      const ref = `${colName(ci)}${rowNo}`
      if (f.kind === 'number' && typeof v === 'number' && Number.isFinite(v)) {
        cells.push(numberCell(ref, v))
      } else {
        cells.push(inlineStr(ref, f.kind === 'date' ? formatDate(String(v)) : String(v)))
      }
    })
    if (hasLoose) cells.push('')
    // 压掉空单元格占位（xlsx 允许缺单元格）
    dataRows.push(`<row r="${rowNo}">${cells.filter((c) => c !== '').join('')}</row>`)
  })

  const sheetXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}">` +
    `<sheetData><row r="1">${headerRow.join('')}</row>${dataRows.join('')}</sheetData>` +
    (media.length > 0 ? `<drawing r:id="rIdDrawing1"/>` : '') +
    `</worksheet>`

  // ---------- styles（仅一个加粗表头样式） ----------
  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="${NS_MAIN}">` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border/></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
    `</styleSheet>`

  // ---------- drawing（图片锚点） ----------
  let drawingXml = ''
  let drawingRels = ''
  if (media.length > 0) {
    const byStored = new Map(media.map((m) => [m.storedAs, m]))
    const EMU = 9525
    const anchors = imageAnchorCols(entries, fields, fields.length)
      .map(({ entryIndex, storedAs, col }, i) => {
        const m = byStored.get(storedAs)
        if (!m) return ''
        const row = entryIndex + 1
        return (
          `<xdr:oneCellAnchor>` +
          `<xdr:from><xdr:col>${col}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
          `<xdr:ext cx="${m.wPx * EMU}" cy="${m.hPx * EMU}"/>` +
          `<xdr:pic>` +
          `<xdr:nvPicPr><xdr:cNvPr id="${i + 1}" name="${xmlEscape(m.storedAs)}"/><xdr:cNvPicPr/></xdr:nvPicPr>` +
          `<xdr:blipFill><a:blip xmlns:r="${NS_R}" r:embed="${m.rid}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
          `<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${m.wPx * EMU}" cy="${m.hPx * EMU}"/></a:xfrm>` +
          `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr>` +
          `</xdr:pic>` +
          `<xdr:clientData/>` +
          `</xdr:oneCellAnchor>`
        )
      })
      .join('')
    drawingXml =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
      anchors +
      `</xdr:wsDr>`
    drawingRels =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      media.map((m) => `<Relationship Id="${m.rid}" Type="${NS_R}/image" Target="../media/${m.zipName.split('/').pop()}"/>`).join('') +
      `</Relationships>`
  }

  // ---------- workbook / rels / content types ----------
  const sheetName = (library.name.replace(/[\\/*?:[\]]/g, '').trim() || '数据').slice(0, 31)
  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${NS_R}/worksheet" Target="worksheets/sheet1.xml"/>` +
    `<Relationship Id="rId2" Type="${NS_R}/styles" Target="styles.xml"/>` +
    `</Relationships>`

  const exts = [...new Set(media.map((m) => m.ext))]
  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    exts.map((ext) => `<Default Extension="${ext}" ContentType="${ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`}"/>`).join('') +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    (media.length > 0 ? `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>` : '') +
    `</Types>`

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${NS_R}/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`

  const sheetRels =
    media.length > 0
      ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rIdDrawing1" Type="${NS_R}/drawing" Target="../drawings/drawing1.xml"/>` +
        `</Relationships>`
      : null

  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rootRels) },
    { name: 'xl/workbook.xml', data: enc.encode(workbookXml) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(workbookRels) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheetXml) },
    { name: 'xl/styles.xml', data: enc.encode(stylesXml) },
    ...(media.length > 0
      ? [
          { name: 'xl/drawings/drawing1.xml', data: enc.encode(drawingXml) },
          { name: 'xl/drawings/_rels/drawing1.xml.rels', data: enc.encode(drawingRels) },
          ...media.map((m) => ({ name: m.zipName, data: m.bytes })),
        ]
      : []),
    ...(sheetRels ? [{ name: 'xl/worksheets/_rels/sheet1.xml.rels', data: enc.encode(sheetRels) }] : []),
  ])
}
