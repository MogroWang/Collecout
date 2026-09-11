import type { Entry, Library, Template } from '../models'
import { entryImagesOf, entryTitle, formatDate, selectedFields, todayIso, type ExportSelection } from './shared'

/**
 * A4 分页排版：PDF 与图片导出共用的渲染层。
 * 页面固定浅色底（导出文档独立于应用主题），文字用系统字体，中文无障碍。
 * 条目图片（bytesOf 提供）随字段缩略绘制。
 */

export const PAGE_W = 794 // A4 @96dpi
export const PAGE_H = 1123
const MARGIN = 56
const SCALE = 2 // 输出像素倍率，保证清晰度

const INK = '#1d1d1f'
const INK_2 = '#6f6e73'
const HAIRLINE = '#e3e2de'
const ACCENT = '#47974f'

const FONT_VALUE = '13px -apple-system, "PingFang SC", "Segoe UI", sans-serif'
const FONT_NAME = '600 12px -apple-system, "PingFang SC", "Segoe UI", sans-serif'
const FONT_TITLE = '700 14px -apple-system, "PingFang SC", "Segoe UI", sans-serif'

const THUMB_H = 72 // 图片缩略图统一高度（px）
const THUMB_GAP = 8

function wrapText(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const out: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    if (raw === '') {
      out.push('')
      continue
    }
    let line = ''
    for (const ch of raw) {
      const next = line + ch
      if (ctx.measureText(next).width > maxWidth && line !== '') {
        out.push(line)
        line = ch
      } else {
        line = next
      }
    }
    if (line !== '') out.push(line)
  }
  return out
}

interface Thumb {
  bmp: ImageBitmap
  w: number
  h: number
}

interface FieldBlock {
  name: string
  lines: string[]
  thumbs: Thumb[]
}

/** 把条目排版为若干 A4 页 canvas（页眉带库名，页脚带页码）。
 *  bytesOf：storedAs → 图片字节；提供时条目图片随字段绘制。 */
export async function renderPages(
  library: Library,
  template: Template,
  entries: Entry[],
  selection: ExportSelection,
  bytesOf?: Map<string, Uint8Array>,
): Promise<HTMLCanvasElement[]> {
  const fields = selectedFields(template, selection.fields)
  const contentW = PAGE_W - MARGIN * 2

  // 字段名列宽：取所有字段名中最宽者，值统一右移对齐，避免名称与内容重叠
  const measure = document.createElement('canvas').getContext('2d')!
  measure.font = FONT_NAME
  const nameW = Math.max(52, ...fields.map((f) => measure.measureText(f.name).width)) + 16
  const valueW = contentW - nameW

  // 预载所有用到的图片位图
  const bmpCache = new Map<string, ImageBitmap | null>()
  if (bytesOf) {
    const wanted = new Set(entries.flatMap((e) => entryImagesOf(e, fields).map((i) => i.storedAs)))
    for (const storedAs of wanted) {
      const bytes = bytesOf.get(storedAs)
      if (!bytes) continue
      try {
        bmpCache.set(storedAs, await createImageBitmap(new Blob([bytes.slice().buffer as ArrayBuffer])))
      } catch {
        bmpCache.set(storedAs, null)
      }
    }
  }

  const thumbsOf = (imgs: { storedAs: string }[]): Thumb[] => {
    const out: Thumb[] = []
    for (const img of imgs) {
      const bmp = bmpCache.get(img.storedAs)
      if (!bmp) continue
      const scale = Math.min(THUMB_H / bmp.height, (contentW - nameW) / bmp.width, 1)
      out.push({ bmp, w: bmp.width * scale, h: bmp.height * scale })
    }
    return out
  }

  const pages: HTMLCanvasElement[] = []
  let ctx: CanvasRenderingContext2D | null = null
  let y = 0

  const newPage = () => {
    const canvas = document.createElement('canvas')
    canvas.width = PAGE_W * SCALE
    canvas.height = PAGE_H * SCALE
    const c = canvas.getContext('2d')!
    c.scale(SCALE, SCALE)
    c.fillStyle = '#ffffff'
    c.fillRect(0, 0, PAGE_W, PAGE_H)
    c.textBaseline = 'top'
    // 页眉
    c.fillStyle = INK
    c.font = '700 15px -apple-system, "PingFang SC", "Segoe UI", sans-serif'
    c.fillText(library.name, MARGIN, MARGIN - 14)
    c.fillStyle = INK_2
    c.font = '10px -apple-system, "PingFang SC", "Segoe UI", sans-serif'
    const meta = `${template.name} · 导出于 ${todayIso()}`
    c.fillText(meta, PAGE_W - MARGIN - c.measureText(meta).width, MARGIN - 14)
    c.fillStyle = HAIRLINE
    c.fillRect(MARGIN, MARGIN + 8, contentW, 1)
    y = MARGIN + 24
    pages.push(canvas)
    ctx = c
  }

  const ensure = (h: number) => {
    if (y + h > PAGE_H - MARGIN) newPage()
  }

  newPage()

  const lineH = 19
  const itemGap = 14

  for (const entry of entries) {
    const title = entryTitle(entry, template)
    // 预排版这个条目的所有内容，估算块高
    measure.font = FONT_TITLE
    const titleLines = wrapText(measure, title, contentW)
    const blocks: FieldBlock[] = []
    for (const f of fields) {
      const v = entry.values[f.id]
      const imgs = entryImagesOf(entry, fields).filter((img) => img.fieldId === f.id)
      if ((v === undefined || String(v) === '') && imgs.length === 0) continue
      const value = v === undefined || String(v) === '' ? '' : f.kind === 'date' ? formatDate(String(v)) : String(v)
      measure.font = FONT_VALUE
      const lines = value === '' ? [] : wrapText(measure, value, valueW)
      blocks.push({ name: f.name, lines, thumbs: thumbsOf(imgs) })
    }
    const loose = thumbsOf(entryImagesOf(entry, fields).filter((img) => !img.fieldId))

    const thumbRowsH = (thumbs: Thumb[]) => {
      if (thumbs.length === 0) return 0
      let rows = 1
      let x = 0
      for (const t of thumbs) {
        if (x + t.w > valueW && x > 0) {
          rows++
          x = 0
        }
        x += t.w + THUMB_GAP
      }
      return rows * (THUMB_H + 8)
    }
    const blockH =
      titleLines.length * 22 + 4 + blocks.reduce((n, b) => n + b.lines.length * lineH + thumbRowsH(b.thumbs), 0) +
      (loose.length > 0 ? lineH * 0 + thumbRowsH(loose) : 0) + 16 + 12

    // 条目从新页开始更整齐；单条目超高时逐行续排
    if (y > MARGIN + 24 && y + Math.min(blockH, 180) > PAGE_H - MARGIN) newPage()

    ctx!.font = FONT_TITLE
    ctx!.fillStyle = INK
    for (const tl of titleLines) {
      ensure(22)
      ctx!.fillText(tl, MARGIN, y)
      y += 22
    }
    y += 4

    const drawThumbs = (thumbs: Thumb[]) => {
      if (thumbs.length === 0) return
      let x = MARGIN + nameW
      let rowMax = 0
      for (const t of thumbs) {
        if (x + t.w > MARGIN + contentW && x > MARGIN + nameW) {
          const before = y
          ensure(rowMax + 8)
          if (y === before) y += rowMax + 8
          x = MARGIN + nameW
          rowMax = 0
        }
        ensure(t.h + 8)
        ctx!.drawImage(t.bmp, x, y, t.w, t.h)
        ctx!.strokeStyle = HAIRLINE
        ctx!.lineWidth = 1
        ctx!.strokeRect(x + 0.5, y + 0.5, t.w - 1, t.h - 1)
        rowMax = Math.max(rowMax, t.h)
        x += t.w + THUMB_GAP
      }
      y += rowMax + 8
    }

    for (const b of blocks) {
      // 字段名列 + 值列同排；仅有图片时先画字段名再画缩略图
      ensure(lineH)
      ctx!.font = FONT_NAME
      ctx!.fillStyle = ACCENT
      ctx!.fillText(b.name, MARGIN, y + 2)
      ctx!.font = FONT_VALUE
      ctx!.fillStyle = INK
      for (const line of b.lines) {
        ensure(lineH)
        ctx!.fillText(line, MARGIN + nameW, y)
        y += lineH
      }
      if (b.lines.length === 0) y += lineH // 只有图片：给字段名留一行高度
      drawThumbs(b.thumbs)
    }
    if (loose.length > 0) {
      ensure(lineH)
      ctx!.font = FONT_NAME
      ctx!.fillStyle = ACCENT
      ctx!.fillText('图片', MARGIN, y + 2)
      drawThumbs(loose)
    }

    ensure(16)
    ctx!.fillStyle = INK_2
    ctx!.font = '10px -apple-system, "PingFang SC", "Segoe UI", sans-serif'
    ctx!.fillText(`来源：${entry.sourceRef.fileName} ${entry.sourceRef.locator}`, MARGIN, y)
    y += 14

    ensure(itemGap)
    ctx!.fillStyle = HAIRLINE
    ctx!.fillRect(MARGIN, y, contentW, 1)
    y += itemGap
  }

  // 页脚页码
  pages.forEach((canvas, i) => {
    const c = canvas.getContext('2d')!
    c.fillStyle = INK_2
    c.font = '10px -apple-system, "PingFang SC", "Segoe UI", sans-serif'
    c.textAlign = 'center'
    c.fillText(`${i + 1} / ${pages.length}`, PAGE_W / 2, PAGE_H - MARGIN + 18)
    c.textAlign = 'left'
  })

  return pages
}

/** canvas 转 JPEG 字节（PDF 用） */
export function canvasToJpeg(canvas: HTMLCanvasElement): Uint8Array {
  const dataUrl = canvas.toDataURL('image/jpeg', 0.86)
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** canvas 转 PNG 字节（图片导出用） */
export function canvasToPng(canvas: HTMLCanvasElement): Uint8Array {
  const dataUrl = canvas.toDataURL('image/png')
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
