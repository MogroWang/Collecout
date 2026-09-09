export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'para'; text: string }
  | { type: 'listItem'; text: string }
  | { type: 'table'; header: string[]; rows: string[][]; source?: string }

export type SourceKind = 'docx' | 'xlsx' | 'text'

export interface ParsedDoc {
  fileName: string
  kind: SourceKind
  blocks: Block[]
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
