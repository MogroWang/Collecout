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

export interface Entry {
  id: string
  libraryId: string
  values: Record<string, EntryValue>
  confidence: Record<string, number>
  sourceRef: SourceRef
  createdAt: string
  updatedAt: string
}

import type { SourceKind } from './parsers/types'

export interface SourceDoc {
  fileName: string
  kind: SourceKind
  importedAt: string
  entryCount: number
}

export interface Library {
  id: string
  name: string
  templateId: string
  sources: SourceDoc[]
  entries: Entry[]
  createdAt: string
  updatedAt: string
}

export type ExportFormat = 'markdown' | 'text' | 'csv' | 'json' | 'folder'

export type ThemeMode = 'system' | 'light' | 'dark'

export interface Settings {
  theme: ThemeMode
  defaultExportFormat: ExportFormat
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  defaultExportFormat: 'markdown',
}

export function newEntry(libraryId: string, sourceRef: SourceRef): Entry {
  const now = new Date().toISOString()
  return {
    id: crypto.randomUUID(),
    libraryId,
    values: {},
    confidence: {},
    sourceRef,
    createdAt: now,
    updatedAt: now,
  }
}
