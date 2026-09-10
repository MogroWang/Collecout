import type { Entry, Library, Template } from '../models'
import { entryTitle, formatDate, selectedFields, todayIso, type ExportSelection } from './shared'

/**
 * A4 分页排版：PDF 与图片导出共用的渲染层。
 * 页面固定浅色底（导出文档独立于应用主题），文字用系统字体，中文无障碍。
 */

export const PAGE_W = 794 // A4 @96dpi
export const PAGE_H = 1123
const MARGIN = 56
const SCALE = 2 // 输出像素倍率，保证清晰度

const INK = '#1d1d1f'
const INK_2 = '#6f6e73'
const HAIRLINE = '#e3e2de'
const ACCENT = '#47974f'

interface Line {
  kind: 'title' | 'field' | 'source' | 'divider'
  text?: string
  name?: string
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
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

/** 把条目排版为若干 A4 页 canvas（页眉带库名，页脚带页码） */
export function renderPages(library: Library, template: Template, entries: Entry[], selection: ExportSelection): HTMLCanvasElement[] {
  const fields = selectedFields(template, selection.fields)
  const contentW = PAGE_W - MARGIN * 2

  const pages: HTMLCanvasElement[] = []
  let ctx: CanvasRenderingContext2D | null = null
  let y = 0
  let pageIndex = 0

  const newPage = () => {
    const canvas = document.createElement('canvas')
    canvas.width = PAGE_W * SCALE
    canvas.height = PAGE_H * SCALE
    const c = canvas.getContext('2d')!
    c.scale(SCALE, SCALE)
    c.fillStyle = '#ffffff'
    c.fillRect(0, 0, PAGE_W, PAGE_H)
    // 页眉
    c.fillStyle = INK
    c.font = '700 15px -apple-system, "PingFang SC", "Segoe UI", sans-serif'
    c.textBaseline = 'top'
    c.fillText(library.name, MARGIN, MARGIN - 14)
    c.fillStyle = INK_2
    c.font = '10px -apple-system, "PingFang SC", "Segoe UI", sans-serif'
    c.fillText(`${template.name} · 导出于 ${todayIso()}`, PAGE_W - MARGIN - c.measureText(`${template.name} · 导出于 ${todayIso()}`).width, MARGIN - 14)
    c.fillStyle = HAIRLINE
    c.fillRect(MARGIN, MARGIN + 8, contentW, 1)
    y = MARGIN + 24
    pages.push(canvas)
    ctx = c
    pageIndex = pages.length
  }

  const ensure = (h: number) => {
    if (y + h > PAGE_H - MARGIN) {
      newPage()
    }
  }

  newPage()

  const lineH = 19
  const itemGap = 14

  for (const entry of entries) {
    const title = entryTitle(entry, template)
    // 预排版这个条目的所有行
    ctx!.font = '700 14px -apple-system, "PingFang SC", "Segoe UI", sans-serif'
    const titleLines = wrapText(ctx!, title, contentW)
    const fieldLines: Line[] = []
    for (const f of fields) {
      const v = entry.values[f.id]
      if (v === undefined || String(v) === '') continue
      const value = f.kind === 'date' ? formatDate(String(v)) : String(v)
      ctx!.font = '13px -apple-system, "PingFang SC", "Segoe UI", sans-serif'
      for (const [li, seg] of wrapText(ctx!, value, contentW - 16).entries()) {
        fieldLines.push({ kind: 'field', name: li === 0 ? `${f.name}` : '', text: seg })
      }
    }
    const sourceLine: Line = { kind: 'source', text: `来源：${entry.sourceRef.fileName} ${entry.sourceRef.locator}` }
    const blockH = titleLines.length * 22 + fieldLines.length * lineH + 16 + 12

    // 条目从新页开始更整齐；单条目超高时逐行续排
    if (y > MARGIN + 24 && y + Math.min(blockH, 120) > PAGE_H - MARGIN) newPage()

    ctx!.font = '700 14px -apple-system, "PingFang SC", "Segoe UI", sans-serif'
    ctx!.fillStyle = INK
    for (const tl of titleLines) {
      ensure(22)
      ctx!.fillText(tl, MARGIN, y)
      y += 22
    }
    y += 4

    ctx!.font = '13px -apple-system, "PingFang SC", "Segoe UI", sans-serif'
    for (const fl of fieldLines) {
      ensure(lineH)
      if (fl.name) {
        ctx!.fillStyle = ACCENT
        ctx!.font = '600 12px -apple-system, "PingFang SC", "Segoe UI", sans-serif'
        ctx!.fillText(fl.name, MARGIN, y)
        ctx!.font = '13px -apple-system, "PingFang SC", "Segoe UI", sans-serif'
      }
      ctx!.fillStyle = INK
      ctx!.fillText(fl.text ?? '', MARGIN + 16, y)
      y += lineH
    }

    ensure(16)
    ctx!.fillStyle = INK_2
    ctx!.font = '10px -apple-system, "PingFang SC", "Segoe UI", sans-serif'
    ctx!.fillText(sourceLine.text!, MARGIN, y)
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
  void pageIndex

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
