import type { Entry, FieldDef, Template } from '../models'

export interface ExportSelection {
  fields: string[]
}

/** 条目图片引用（Entry.images 的子集视图） */
export interface EntryImageRef {
  storedAs: string
  fieldId?: string
}

/** 条目在所选字段范围内的图片；fieldId 为空 = 条目级图片，始终保留 */
export function entryImagesOf(entry: Entry, fields: FieldDef[]): EntryImageRef[] {
  return (entry.images ?? []).filter((img) => !img.fieldId || fields.some((f) => f.id === img.fieldId))
}

export function selectedFields(template: Template, ids: string[] | null) {
  const chosen = ids ?? template.fields.map((f) => f.id)
  return template.fields.filter((f) => chosen.includes(f.id))
}

export function entryTitle(entry: Entry, template: Template): string {
  const field = template.fields.find((f) => f.kind === 'text' && /标题|主题|题目|书名|项目|name|title/i.test(f.name))
    ?? template.fields.find((f) => f.kind === 'text')
  const v = field ? entry.values[field.id] : undefined
  const s = v === undefined ? '' : String(v).trim()
  return s === '' ? '未命名' : s.split(/\r?\n/)[0].slice(0, 60)
}

export function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : iso
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function csvEscape(v: string): string {
  if (/[",\n\r]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}
