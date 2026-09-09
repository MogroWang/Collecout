export interface DateHit {
  iso: string
  confidence: number
  index: number
  text: string
}

interface PatternDef {
  re: RegExp
  build: (m: RegExpExecArray) => { y?: number; m?: number; d?: number } | null
  confidence: number
}

const EN_MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

const PATTERNS: PatternDef[] = [
  // 2026年9月3日 / 2026-9-3 / 2026/9/3 / 2026.9.3（时间部分留在匹配区间外）
  {
    re: /(\d{4})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})\s*日?/g,
    build: (m) => ({ y: +m[1], m: +m[2], d: +m[3] }),
    confidence: 0.9,
  },
  // 2026年9月 / 2026-09（补 1 日）
  {
    re: /(\d{4})\s*[年\-/]\s*(\d{1,2})\s*月?/g,
    build: (m) => ({ y: +m[1], m: +m[2], d: 1 }),
    confidence: 0.7,
  },
  // 9月3日（无年份，补当前年）
  {
    re: /(\d{1,2})\s*月\s*(\d{1,2})\s*日/g,
    build: (m) => ({ y: new Date().getFullYear(), m: +m[1], d: +m[2] }),
    confidence: 0.45,
  },
  // September 3, 2026 / Sep 3 2026
  {
    re: /([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/g,
    build: (m) => {
      const mo = EN_MONTHS[m[1].toLowerCase().slice(0, 3)]
      return mo ? { y: +m[3], m: mo, d: +m[2] } : null
    },
    confidence: 0.85,
  },
  // 3 September 2026 / 3 Sep 2026
  {
    re: /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?\s+(\d{4})/g,
    build: (m) => {
      const mo = EN_MONTHS[m[2].toLowerCase().slice(0, 3)]
      return mo ? { y: +m[3], m: mo, d: +m[1] } : null
    },
    confidence: 0.85,
  },
]

function toIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${y}-${pad(m)}-${pad(d)}`
}

/** 在一段文本中按出现顺序找出所有日期（更精确的模式优先认领区间，重叠命中丢弃） */
export function findDates(text: string): DateHit[] {
  const hits: DateHit[] = []
  const spans: [number, number][] = []
  const overlaps = (s: number, e: number) => spans.some(([a, b]) => s < b && a < e)
  for (const { re, build, confidence } of PATTERNS) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const parts = build(m)
      if (!parts || parts.y === undefined || parts.m === undefined || parts.d === undefined) continue
      const iso = toIso(parts.y, parts.m, parts.d)
      if (!iso) continue
      const start = m.index
      const end = start + m[0].length
      if (overlaps(start, end)) continue
      spans.push([start, end])
      hits.push({ iso, confidence, index: start, text: m[0].trim() })
    }
  }
  return hits.sort((a, b) => a.index - b.index)
}

/** 取文本中第一个可识别的日期 */
export function parseDateSmart(text: string): DateHit | null {
  return findDates(text)[0] ?? null
}

/** 把「2026年9月3日 14:00」之类整理成 ISO 日期，失败返回 null */
export function normalizeDateValue(raw: string): string | null {
  return parseDateSmart(raw)?.iso ?? null
}

/** 把各种写法的数字整理成 number，失败返回 null */
export function normalizeNumberValue(raw: string): number | null {
  const cleaned = raw.replace(/[,\s￥¥$元]/g, '').replace(/，/g, '')
  const m = /-?\d+(?:\.\d+)?/.exec(cleaned)
  if (!m) return null
  const n = Number(m[0])
  return Number.isFinite(n) ? n : null
}
