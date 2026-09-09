import type { ParsedDoc } from './types'
import { parseText } from './text'
import { parseDocx } from './docx'
import { parseSheet } from './xlsx'

export { parseText } from './text'
export { htmlToBlocks } from './html'

const TEXT_EXT = /\.(txt|md|markdown)$/i
const SHEET_EXT = /\.(xlsx|xlsm|csv)$/i
const DOCX_EXT = /\.docx$/i

export const ACCEPTED_EXTENSIONS = '.docx,.xlsx,.xlsm,.csv,.txt,.md,.markdown'

/** 按扩展名分发解析器，返回统一的块结构文档 */
export async function parseFile(file: File): Promise<ParsedDoc> {
  const name = file.name
  if (DOCX_EXT.test(name)) {
    return parseDocx(await file.arrayBuffer(), name)
  }
  if (SHEET_EXT.test(name)) {
    return parseSheet(await file.arrayBuffer(), name)
  }
  if (TEXT_EXT.test(name)) {
    return { fileName: name, kind: 'text', blocks: parseText(await file.text()) }
  }
  throw new Error(`暂不支持「${name}」的格式，请使用 .docx、.xlsx、.csv、.txt 或 .md 文件`)
}
