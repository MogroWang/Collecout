import * as XLSX from 'xlsx'
import type { Block, ParsedDoc } from './types'

/** Excel / CSV 解析：每个 sheet 生成一个表格块，首行为表头 */
export function parseSheet(data: ArrayBuffer, fileName: string): ParsedDoc {
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
  return { fileName, kind: 'xlsx', blocks }
}
