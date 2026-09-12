export type FieldKind = 'text' | 'date' | 'number' | 'tag'

export type ExtractStrategy = 'auto' | 'keyword' | 'regex' | 'heading' | 'tableMap'

export interface FieldDef {
  id: string
  name: string
  kind: FieldKind
  strategy: ExtractStrategy
  /** strategy = regex 时的正则表达式，应包含一个捕获组 */
  pattern?: string
  /** strategy = keyword 时的附加关键词（字段名本身始终参与匹配） */
  keywords?: string[]
}

export interface Template {
  id: string
  name: string
  description: string
  builtin: boolean
  fields: FieldDef[]
}

export type EntryValue = string | number

export interface SourceRef {
  fileName: string
  locator: string
}

/** 导入时随库存档的源文件（复制副本或原位置引用） */
export interface StoredFile {
  id: string
  /** 原始文件名 */
  name: string
  /** 库文件夹 files/ 内的存储名（重名自动加序号） */
  storedAs: string
  /** copy = 已复制进库文件夹；link = 保留在原位置，仅记录路径 */
  mode: 'copy' | 'link'
  /** source = 导入的源文件；image = Excel 单元格图片 */
  kind?: 'source' | 'image'
  /** kind = image 时的单元格锚点（0 起始行列） */
  anchor?: { sheet: string; row: number; col: number }
  /** mode = link 时的原始绝对路径 */
  sourcePath?: string
  importedAt: string
}

export interface Entry {
  id: string
  libraryId: string
  values: Record<string, EntryValue>
  confidence: Record<string, number>
  sourceRef: SourceRef
  /** 单元格图片：fieldId 指向所属字段（列），与文字值一样随字段展示 */
  images?: EntryImage[]
  createdAt: string
  updatedAt: string
}

/** 条目里的单元格图片（Excel 导入；storedAs 为库文件夹 files/ 内的存储名） */
export interface EntryImage {
  storedAs: string
  /** 图片所在列对应的字段 id；无列归属（文档来源等）时缺省 */
  fieldId?: string
}

import type { SourceKind } from './parsers/types'

export type { SourceKind }

export interface SourceDoc {
  fileName: string
  kind: SourceKind
  importedAt: string
  entryCount: number
  /** 本次导入存档的文件；0.3 及更早的来源没有此字段 */
  files?: StoredFile[]
}

export interface Library {
  id: string
  name: string
  templateId: string
  /** 库自带字段快照：条目值按键即这里的字段 id，不随模板后续变化 */
  fields: FieldDef[]
  sources: SourceDoc[]
  entries: Entry[]
  createdAt: string
  updatedAt: string
  /**
   * 库的存放：0.4.0 起每个库是一个文件夹（library.json + files/）。
   * storagePath 为空 → 数据文件夹内 libraries/<id>/；
   * 有值 → 独立存放在 <storagePath>/<folderName>/（桌面端）。
   */
  storagePath?: string | null
  /** 独立存放时的文件夹名；内部库固定为 libraries/<id>/，无需此字段 */
  fileName?: string | null
}

export type ExportFormat = 'markdown' | 'text' | 'csv' | 'json' | 'folder' | 'docx' | 'xlsx' | 'pdf' | 'image'

export type ThemeMode = 'system' | 'light' | 'dark'

/**
 * 界面字体：FONT_PRESETS 里的预设 id（'system' 跟随系统），或任意 CSS font-family 值（自定义）。
 * 预设表在 stores/settings.ts 中（应用与设置页共用）。
 */
export type FontSetting = string

export interface Settings {
  theme: ThemeMode
  defaultExportFormat: ExportFormat
  fontFamily: FontSetting
  /** 界面字号缩放（1rem = 10px × 此值），设置页滑块可调，范围 0.85–1.3 */
  fontScale: number
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  defaultExportFormat: 'markdown',
  fontFamily: 'system',
  fontScale: 1,
}

/** crypto.randomUUID 仅在安全上下文可用，兜底保证任何环境都能生成 id */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** 深拷贝纯 JSON 数据（structuredClone 无法克隆 Vue 的 reactive proxy，模板等响应式数据一律用它） */
export function plainClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function newEntry(libraryId: string, sourceRef: SourceRef): Entry {
  const now = new Date().toISOString()
  return {
    id: uuid(),
    libraryId,
    values: {},
    confidence: {},
    sourceRef,
    createdAt: now,
    updatedAt: now,
  }
}
