import type { Entry, Library, Template } from '../models'
import { entryTitle, formatDate, selectedFields, todayIso, type ExportSelection } from './shared'

/* ---------- 最小 ZIP 实现（stored 不压缩，docx 内容小，足够用） ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2))
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  return { time, date }
}

/** 生成 stored（不压缩）ZIP 包；返回可直接落盘的字节 */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder()
  const now = dosDateTime(new Date())
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const f of files) {
    const nameBytes = enc.encode(f.name)
    const crc = crc32(f.data)
    const local = new Uint8Array(30 + nameBytes.length + f.data.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0, true)
    lv.setUint16(8, 0, true) // stored
    lv.setUint16(10, now.time, true)
    lv.setUint16(12, now.date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, f.data.length, true)
    lv.setUint32(22, f.data.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    local.set(f.data, 30 + nameBytes.length)
    locals.push(local)

    const central = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, now.time, true)
    cv.setUint16(14, now.date, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, f.data.length, true)
    cv.setUint32(24, f.data.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centrals.push(central)

    offset += local.length
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  const total = offset + centralSize + 22
  const out = new Uint8Array(total)
  let pos = 0
  for (const b of [...locals, ...centrals, eocd]) {
    out.set(b, pos)
    pos += b.length
  }
  return out
}

/* ---------- OOXML 文档 ---------- */

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '')
}

function paragraph(runs: { text: string; bold?: boolean; style?: string }[]): string {
  const body = runs
    .map((r) => {
      let rPr = ''
      if (r.style) rPr = `<w:rPr><w:rStyle w:val="${r.style}"/></w:rPr>`
      else if (r.bold) rPr = '<w:rPr><w:b/></w:rPr>'
      return `<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(r.text)}</w:t></w:r>`
    })
    .join('')
  return `<w:p>${body}</w:p>`
}

function textParagraphs(text: string, style?: string): string {
  const lines = text.split(/\r?\n/)
  return lines.map((line) => paragraph([{ text: line === '' ? ' ' : line, style }])).join('')
}

/** 把条目导出为 .docx（零依赖：手写 stored ZIP + 最小 OOXML，Word/WPS/Pages 均可打开） */
export function exportDocxBytes(library: Library, template: Template, entries: Entry[], selection: ExportSelection): Uint8Array {
  const fields = selectedFields(template, selection.fields)
  const enc = new TextEncoder()

  const body: string[] = []
  body.push(paragraph([{ text: library.name, style: 'Title' }]))
  body.push(paragraph([{ text: `${template.name} · 共 ${entries.length} 条 · 导出于 ${todayIso()}`, style: 'Source' }]))

  entries.forEach((entry, i) => {
    body.push(paragraph([{ text: `${i + 1}. ${entryTitle(entry, template)}`, style: 'Heading1' }]))
    for (const f of fields) {
      const v = entry.values[f.id]
      if (v === undefined || String(v) === '') continue
      const value = f.kind === 'date' ? formatDate(String(v)) : String(v)
      body.push(textParagraphs(`${f.name}：${value}`))
    }
    body.push(paragraph([{ text: `来源：${entry.sourceRef.fileName} ${entry.sourceRef.locator}`, style: 'Source' }]))
  })

  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>` +
    body.join('') +
    `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>` +
    `</w:body></w:document>`

  const stylesXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
    `<w:docDefaults><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="等线" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="52"/><w:color w:val="1d1d1f"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>` +
    `<w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/></w:pPr>` +
    `<w:rPr><w:b/><w:sz w:val="30"/><w:color w:val="47974f"/></w:rPr></w:style>` +
    `<w:style w:type="paragraph" w:styleId="Source"><w:name w:val="Source"/><w:basedOn w:val="Normal"/>` +
    `<w:rPr><w:sz w:val="17"/><w:color w:val="6f6e73"/></w:rPr></w:style>` +
    `</w:styles>`

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>` +
    `<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` +
    `</Types>`

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>` +
    `</Relationships>`

  const docRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`

  return zipStore([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rootRels) },
    { name: 'word/document.xml', data: enc.encode(documentXml) },
    { name: 'word/_rels/document.xml.rels', data: enc.encode(docRels) },
    { name: 'word/styles.xml', data: enc.encode(stylesXml) },
  ])
}
