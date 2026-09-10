import { PAGE_H, PAGE_W } from './render'

/**
 * 最小 PDF 生成器：每页一张 JPEG 图像（DCTDecode），A4 页面。
 * 文字已由排版层画进图像，因此对字体/中文没有任何特殊要求。
 */
export function buildPdf(pages: { jpeg: Uint8Array; pixelW: number; pixelH: number }[]): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let pos = 0

  const push = (s: string | Uint8Array) => {
    const b = typeof s === 'string' ? enc.encode(s) : s
    chunks.push(b)
    pos += b.length
  }
  const beginObj = (n: number) => {
    offsets[n] = pos
    push(`${n} 0 obj\n`)
  }

  push('%PDF-1.4\n')
  // 二进制标记行：提示外部工具本文件含二进制流（必须逐字节写出）
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))

  const W = 595.28
  const H = 841.89
  const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ')

  beginObj(1)
  push(`<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`)
  beginObj(2)
  push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`)

  pages.forEach((p, i) => {
    const pageObj = 3 + i * 3
    const imgObj = pageObj + 1
    const contentObj = pageObj + 2
    beginObj(pageObj)
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
        `/Resources << /XObject << /Im0 ${imgObj} 0 R >> >> /Contents ${contentObj} 0 R >>\nendobj\n`,
    )
    beginObj(imgObj)
    push(
      `<< /Type /XObject /Subtype /Image /Width ${p.pixelW} /Height ${p.pixelH} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
    )
    push(p.jpeg)
    push(`\nendstream\nendobj\n`)
    beginObj(contentObj)
    const content = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q\n`
    push(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`)
  })

  const xrefPos = pos
  const count = 3 + pages.length * 3
  let xref = `xref\n0 ${count + 1}\n0000000000 65535 f \n`
  for (let n = 1; n <= count; n++) {
    xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  }
  push(xref)
  push(`trailer\n<< /Size ${count + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`)

  const out = new Uint8Array(pos)
  let p2 = 0
  for (const b of chunks) {
    out.set(b, p2)
    p2 += b.length
  }
  return out
}

/** A4 pt 尺寸（供调用方使用） */
export const PDF_PAGE = { w: PAGE_W * 0.75, h: PAGE_H * 0.75 }
