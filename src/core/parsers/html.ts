import type { Block } from './types'

/** 把 mammoth 产出的 HTML（标题/段落/列表/表格）转换为块结构 */
export function htmlToBlocks(html: string): Block[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const blocks: Block[] = []
  const walk = (node: Element) => {
    for (const el of Array.from(node.children)) {
      const tag = el.tagName.toLowerCase()
      if (/^h[1-6]$/.test(tag)) {
        const text = textOf(el)
        if (text) blocks.push({ type: 'heading', level: Number(tag[1]), text })
      } else if (tag === 'p') {
        const text = textOf(el)
        if (text) blocks.push({ type: 'para', text })
      } else if (tag === 'li') {
        const text = textOf(el)
        if (text) blocks.push({ type: 'listItem', text })
      } else if (tag === 'table') {
        const table = tableOf(el)
        if (table) blocks.push(table)
      } else {
        walk(el)
      }
    }
  }
  walk(doc.body)
  return blocks
}

function textOf(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function tableOf(table: Element): Block | null {
  const rows: string[][] = []
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    const cells = Array.from(tr.querySelectorAll('th,td')).map((td) => textOf(td))
    if (cells.some((c) => c !== '')) rows.push(cells)
  }
  if (rows.length === 0) return null
  const [header, ...body] = rows
  const width = Math.max(...rows.map((r) => r.length))
  const pad = (r: string[]) => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r)
  return { type: 'table', header: pad(header ?? []), rows: body.map(pad) }
}
