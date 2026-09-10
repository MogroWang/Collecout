import type { ParsedDoc } from './types'
import { parseText } from './text'
import { parseDocx } from './docx'
import { parseSheet } from './xlsx'

export { parseText } from './text'
export { htmlToBlocks } from './html'

const TEXT_EXT = /\.(txt|md|markdown)$/i
const SHEET_EXT = /\.(xlsx|xlsm|csv)$/i
const DOCX_EXT = /\.docx$/i

/**
 * 按扩展名分发解析器，返回统一的块结构文档。
 * 其余任意扩展名不解析内容，作为「附件文件」随库存档。
 */
export async function parseFile(fileName: string, data: Uint8Array): Promise<ParsedDoc> {
  if (DOCX_EXT.test(fileName)) {
    return parseDocx(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, fileName)
  }
  if (SHEET_EXT.test(fileName)) {
    return parseSheet(data, fileName)
  }
  if (TEXT_EXT.test(fileName)) {
    const text = new TextDecoder().decode(data)
    return { fileName, kind: 'text', blocks: parseText(text) }
  }
  return { fileName, kind: 'file', blocks: [] }
}
