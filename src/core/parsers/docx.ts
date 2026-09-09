import mammoth from 'mammoth'
import type { ParsedDoc } from './types'
import { htmlToBlocks } from './html'

export async function parseDocx(data: ArrayBuffer, fileName: string): Promise<ParsedDoc> {
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer: data })
  return { fileName, kind: 'docx', blocks: htmlToBlocks(html) }
}
