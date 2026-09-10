import type { ExtractedImage } from './xlsx'

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'para'; text: string }
  | { type: 'listItem'; text: string }
  | { type: 'table'; header: string[]; rows: string[][]; source?: string; /** rows[i] 在工作表中的 0 起始行号（含表头行）；跳过空行时保证不错位 */ rowMap?: number[] }

/** 'file' = 无法解析文本的任意文件，仅作为附件随库存档 */
export type SourceKind = 'docx' | 'xlsx' | 'text' | 'file'

export interface ParsedDoc {
  fileName: string
  kind: SourceKind
  blocks: Block[]
  /** xlsx 单元格图片（其他格式无） */
  images?: ExtractedImage[]
}

export function countBlocks(blocks: Block[]) {
  let headings = 0
  let tables = 0
  let paras = 0
  for (const b of blocks) {
    if (b.type === 'heading') headings++
    else if (b.type === 'table') tables++
    else paras++
  }
  return { headings, tables, paras }
}
