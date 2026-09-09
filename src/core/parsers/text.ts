import type { Block } from './types'

/**
 * 纯文本解析：按行识别 Markdown 标题、列表项与小节分隔线。
 * 「key: value」行不在此处特殊处理，交给提取引擎统一识别。
 */
export function parseText(content: string): Block[] {
  const blocks: Block[] = []
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() })
      continue
    }
    if (/^(-{3,}|={3,}|\*{3,})$/.test(line)) continue
    const bullet = /^([-*•·]|\d+[.、)])\s+(.+)$/.exec(line)
    if (bullet) {
      blocks.push({ type: 'listItem', text: bullet[2].trim() })
      continue
    }
    blocks.push({ type: 'para', text: line })
  }
  return blocks
}
