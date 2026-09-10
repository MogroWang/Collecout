// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { initRepo } from '../core/storage/repo'
import { parseFile } from '../core/parsers'
import { extractFromTable } from '../core/extract'
import { zipStore } from '../core/export/docx'
import { useLibrariesStore } from './libraries'

const PNG_BYTES = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)
const enc = new TextEncoder()
const x = (s: string) => enc.encode(s)

/** 两张「嵌入单元格图片」分别锚定在第 2、3 行（richData 结构） */
function makeXlsx(): Uint8Array {
  return zipStore([
    { name: '[Content_Types].xml', data: x(`<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/></Types>`) },
    { name: '_rels/.rels', data: x(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: 'xl/workbook.xml', data: x(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="明细列表" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', data: x(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId6" Type="http://schemas.microsoft.com/office/2017/06/relationships/sheetMetadata" Target="metadata.xml"/></Relationships>`) },
    { name: 'xl/metadata.xml', data: x(`<?xml version="1.0"?><metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><valueMetadata count="2"><bk><rc t="1" v="0"/></bk><bk><rc t="1" v="1"/></bk></valueMetadata></metadata>`) },
    { name: 'xl/richData/rdrichvalue.xml', data: x(`<?xml version="1.0"?><rvData xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="2"><rv s="0"><v>0</v><v>5</v></rv><rv s="0"><v>1</v><v>5</v></rv></rvData>`) },
    { name: 'xl/richData/rdrichvaluestructure.xml', data: x(`<?xml version="1.0"?><rvStructures xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="1"><s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/></s></rvStructures>`) },
    { name: 'xl/richData/richValueRel.xml', data: x(`<?xml version="1.0"?><richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><rel r:id="rId1"/><rel r:id="rId2"/></richValueRels>`) },
    { name: 'xl/richData/_rels/richValueRel.xml.rels', data: x(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.png"/></Relationships>`) },
    { name: 'xl/worksheets/sheet1.xml', data: x(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>标题</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>第一条</t></is></c><c r="B2" vm="1" t="e"><v>#VALUE!</v></c></row><row r="3"><c r="A3" t="inlineStr"><is><t>第二条</t></is></c><c r="B3" vm="2" t="e"><v>#VALUE!</v></c></row></sheetData></worksheet>`) },
    { name: 'xl/media/image1.png', data: PNG_BYTES },
    { name: 'xl/media/image2.png', data: PNG_BYTES },
  ])
}

beforeEach(async () => {
  localStorage.clear()
  setActivePinia(createPinia())
  await initRepo()
})

describe('Excel 图片与条目行的映射', () => {
  it('每张单元格图片按结构化行号对应到正确的条目', async () => {
    const doc = await parseFile('带图.xlsx', makeXlsx())
    const table = doc.blocks.find((b) => b.type === 'table')!
    if (table.type !== 'table') throw new Error('no table')
    expect(doc.images).toHaveLength(2)
    expect(table.rowMap).toEqual([0, 1, 2])

    const template = {
      id: 't', name: 't', description: '', builtin: true,
      fields: [
        { id: 'f1', name: '标题', kind: 'text' as const, strategy: 'tableMap' as const },
        { id: 'f2', name: '凭证', kind: 'text' as const, strategy: 'tableMap' as const },
      ],
    }
    const mapping = { f1: 0, f2: 1 }
    const drafts = extractFromTable(
      table.rows,
      template,
      mapping,
      {},
      { fileName: doc.fileName, locator: (i) => `「明细列表」第 ${i + 2} 行` },
      (i) => ({ sourceRow: table.rowMap ? table.rowMap[i + 1] : i + 1 }),
    )
    expect(drafts.map((d) => d.sourceRow)).toEqual([1, 2])

    const libraries = useLibrariesStore()
    const lib = await libraries.create('验证库', 't', template.fields)
    const r = await libraries.addEntries(lib.id, drafts, { fileName: doc.fileName, kind: 'xlsx' }, template.fields)

    // 模拟 commit 的映射段：锚点 → 草稿位置 → 条目 + 字段（列 → 表头 → 字段 id）
    const images = doc.images ?? []
    const pairs: { entryId: string; storedAs: string; fieldId?: string }[] = []
    for (const img of images) {
      const di = drafts.findIndex((d) => d.sourceRow === img.row)
      const entry = r.entries[di]
      if (!entry) continue
      const fieldId = Object.entries(mapping).find(([, col]) => col === img.col)?.[0]
      pairs.push({ entryId: entry.id, storedAs: img.name, fieldId })
    }
    await libraries.attachEntryImages(lib.id, pairs)

    const entries = libraries.libraries[0].entries
    const first = entries.find((e) => e.values.f1 === '第一条')!
    const second = entries.find((e) => e.values.f1 === '第二条')!
    expect(first.images).toEqual([{ storedAs: 'image1.png', fieldId: 'f2' }])
    expect(second.images).toEqual([{ storedAs: 'image2.png', fieldId: 'f2' }])
  })
})
