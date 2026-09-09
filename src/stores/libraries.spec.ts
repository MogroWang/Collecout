// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { DraftEntry } from '../core/extract'
import type { FieldDef, Library } from '../core/models'
import { initRepo, repo } from '../core/storage/repo'
import { useLibrariesStore } from './libraries'

function draft(values: Record<string, string>, confidence: Record<string, number> = {}): DraftEntry {
  return { values, confidence, sourceRef: { fileName: '流水.xlsx', locator: '第 2 行' } }
}

const sourceFields: FieldDef[] = [
  { id: 'f_col0', name: '日期', kind: 'date', strategy: 'tableMap' },
  { id: 'f_col1', name: '金额', kind: 'number', strategy: 'tableMap' },
]

async function readPersisted(id: string): Promise<Library | null> {
  return repo().readJSON<Library | null>(`libraries/${id}.json`, null)
}

beforeEach(async () => {
  localStorage.clear()
  setActivePinia(createPinia())
  await initRepo()
})

describe('libraries store 字段快照与重映射', () => {
  it('建库保存字段快照，入库时草稿值按字段名重映射到库字段', async () => {
    const store = useLibrariesStore()
    const lib = await store.create('收支', 'tpl_auto', sourceFields)
    expect(lib.fields.map((f) => f.name)).toEqual(['日期', '金额'])

    await store.addEntries(lib.id, [draft({ f_col0: '2026-08-01', f_col1: '32.5' }, { f_col0: 0.9 })], {
      fileName: '流水.xlsx',
      kind: 'xlsx',
    }, sourceFields)

    const dateId = lib.fields[0].id
    const amountId = lib.fields[1].id
    expect(lib.entries[0].values[dateId]).toBe('2026-08-01')
    expect(lib.entries[0].values[amountId]).toBe('32.5')
    expect(lib.entries[0].confidence[dateId]).toBe(0.9)

    // 即时落盘：addEntries 返回后即可从存储读回，无需等待防抖
    const persisted = await readPersisted(lib.id)
    expect(persisted?.entries[0].values[dateId]).toBe('2026-08-01')
    expect(persisted?.fields).toHaveLength(2)
  })

  it('自动识别的草稿（f_colN）不再映射到内置 tpl_auto 的空字段表，条目始终有键', async () => {
    const store = useLibrariesStore()
    // 模拟 0.2.0 提交流程：新库的字段快照来自现场推断的字段
    const lib = await store.create('自动库', 'tpl_auto', sourceFields)
    await store.addEntries(lib.id, [draft({ f_col0: '2026-08-01', f_col1: '32.5' })], {
      fileName: '流水.xlsx',
      kind: 'xlsx',
    }, sourceFields)
    expect(Object.keys(lib.entries[0].values)).toEqual(lib.fields.map((f) => f.id))
  })

  it('追加导入时同名字段对齐，新列补充进库字段表', async () => {
    const store = useLibrariesStore()
    const lib = await store.create('收支', 'tpl_auto', sourceFields)
    const newFields: FieldDef[] = [
      { id: 'g_col0', name: '日期', kind: 'date', strategy: 'tableMap' },
      { id: 'g_col1', name: '金额', kind: 'number', strategy: 'tableMap' },
      { id: 'g_col2', name: '备注', kind: 'text', strategy: 'tableMap' },
    ]
    await store.addEntries(lib.id, [draft({ g_col0: '2026-09-01', g_col1: '12', g_col2: '打车' })], {
      fileName: '九月.xlsx',
      kind: 'xlsx',
    }, newFields)

    // 库字段仍为 3 个（日期/金额复用，备注新增），条目值全部落在库字段 id 上
    expect(lib.fields.map((f) => f.name)).toEqual(['日期', '金额', '备注'])
    const noteId = lib.fields[2].id
    expect(lib.entries[0].values[lib.fields[0].id]).toBe('2026-09-01')
    expect(lib.entries[0].values[noteId]).toBe('打车')
    // 两条来源都被记录
    expect(lib.sources.map((s) => s.fileName)).toEqual(['九月.xlsx'])
  })

  it('0.1.0 旧库加载时自动重建字段表，入库内容恢复可见', async () => {
    // 直接写一份 0.1.0 格式的库 JSON（无 fields，值按推断 id 记录）
    const legacy: Library = {
      id: 'legacy-1',
      name: '旧库',
      templateId: 'tpl_auto',
      fields: undefined as unknown as FieldDef[],
      sources: [{ fileName: '流水.xlsx', kind: 'xlsx', importedAt: '2026-09-01T00:00:00.000Z', entryCount: 1 }],
      entries: [
        {
          id: 'e1',
          libraryId: 'legacy-1',
          values: { f_col0: '2026-08-01', f_col1: '32.5' },
          confidence: {},
          sourceRef: { fileName: '流水.xlsx', locator: '第 2 行' },
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
      ],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }
    await repo().saveNow('libraries/legacy-1.json', legacy)

    const store = useLibrariesStore()
    await store.load()
    const lib = store.byId('legacy-1')!
    expect(lib.fields.map((f) => f.name)).toEqual(['列1', '列2'])
    // 字段 id 与条目值的键一致 → 视图层能渲染出内容
    expect(lib.entries[0].values[lib.fields[0].id]).toBe('2026-08-01')
  })

  it('带字段的旧库（如显式模板导入）直接沿用模板字段', async () => {
    const legacy = {
      id: 'legacy-2',
      name: '旧库2',
      templateId: 'tpl_ledger',
      sources: [],
      entries: [],
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }
    await repo().saveNow('libraries/legacy-2.json', legacy)
    const store = useLibrariesStore()
    await store.load()
    const lib = store.byId('legacy-2')!
    // tpl_ledger 的内置字段被用作快照
    expect(lib.fields.map((f) => f.name)).toEqual(['日期', '项目', '类别', '金额', '收支', '备注'])
  })
})
