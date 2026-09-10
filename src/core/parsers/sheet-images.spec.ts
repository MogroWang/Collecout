// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { zipStore } from '../export/docx'
import { parseSheet } from './xlsx'

// 1×1 红色 PNG（最小合法 PNG）
const PNG_BYTES = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

const enc = new TextEncoder()

/** 手写一个最小但结构完整的 xlsx：1 个工作表「流水」+ 两张锚定到单元格的图片（浮动 drawing） */
function makeXlsx(): Uint8Array {
  return zipStore([
    {
      name: '[Content_Types].xml',
      data: enc.encode(
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Default Extension="png" ContentType="image/png"/></Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      data: enc.encode(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: enc.encode(
        `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
          `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets><sheet name="流水" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: enc.encode(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: enc.encode(
        `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
          `<sheetData>` +
          `<row r="1"><c r="A1" t="inlineStr"><is><t>标题</t></is></c><c r="B1" t="inlineStr"><is><t>金额</t></is></c></row>` +
          `<row r="2"><c r="A2" t="inlineStr"><is><t>第一条</t></is></c><c r="B2"><v>20</v></c></row>` +
          `<row r="3"><c r="A3" t="inlineStr"><is><t>第二条</t></is></c><c r="B3"><v>40</v></c></row>` +
          `</sheetData></worksheet>`,
      ),
    },
    {
      name: 'xl/worksheets/_rels/sheet1.xml.rels',
      data: enc.encode(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/drawings/drawing1.xml',
      data: enc.encode(
        `<?xml version="1.0"?>` +
          `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ` +
          `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
          `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>2</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
          `<xdr:pic><xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor>` +
          `<xdr:twoCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>` +
          `<xdr:pic><xdr:blipFill><a:blip r:embed="rId2"/></xdr:blipFill></xdr:pic></xdr:twoCellAnchor>` +
          `</xdr:wsDr>`,
      ),
    },
    {
      name: 'xl/drawings/_rels/drawing1.xml.rels',
      data: enc.encode(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>` +
          `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image2.png"/>` +
          `</Relationships>`,
      ),
    },
    { name: 'xl/media/image1.png', data: PNG_BYTES },
    { name: 'xl/media/image2.png', data: PNG_BYTES },
  ])
}

describe('xlsx 单元格图片提取', () => {
  it('解析表格内容的同时提取图片与单元格锚点', async () => {
    const doc = await parseSheet(makeXlsx(), '带图表格.xlsx')
    expect(doc.kind).toBe('xlsx')
    // 表格内容照常解析
    const table = doc.blocks.find((b) => b.type === 'table')
    expect(table).toBeDefined()
    expect(table!.source).toBe('流水')
    // 图片：锚点、工作表名与字节都对得上
    expect(doc.images).toHaveLength(2)
    const [first, second] = doc.images!
    expect(first.sheet).toBe('流水')
    expect(first.row).toBe(2)
    expect(first.col).toBe(1)
    expect(first.name).toBe('image1.png')
    expect(Array.from(first.bytes.subarray(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(second.row).toBe(1)
    expect(second.col).toBe(3)
  })
})

/**
 * 手写「嵌入单元格图片」版 xlsx（Excel 365 的 Picture in Cell）：
 * 图片不走 drawing，而是 sheet 单元格 vm → metadata → richData → richValueRel → media。
 */
function makeRichValueXlsx(): Uint8Array {
  return zipStore([
    {
      name: '[Content_Types].xml',
      data: enc.encode(
        `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Default Extension="png" ContentType="image/png"/></Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      data: enc.encode(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: enc.encode(
        `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
          `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets><sheet name="明细列表" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: enc.encode(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
          `<Relationship Id="rId6" Type="http://schemas.microsoft.com/office/2017/06/relationships/sheetMetadata" Target="metadata.xml"/>` +
          `</Relationships>`,
      ),
    },
    {
      name: 'xl/metadata.xml',
      data: enc.encode(
        `<?xml version="1.0"?><metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
          `xmlns:xlrd="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata">` +
          `<futureMetadata name="XLRICHVALUE" count="1"><bk><extLst><ext uri="{3e2802c4}"><xlrd:rvb i="0"/></ext></extLst></bk></futureMetadata>` +
          `<valueMetadata count="1"><bk><rc t="1" v="0"/></bk></valueMetadata></metadata>`,
      ),
    },
    {
      name: 'xl/richData/rdrichvalue.xml',
      data: enc.encode(
        `<?xml version="1.0"?><rvData xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="1">` +
          `<rv s="0"><v>0</v><v>5</v></rv></rvData>`,
      ),
    },
    {
      name: 'xl/richData/rdrichvaluestructure.xml',
      data: enc.encode(
        `<?xml version="1.0"?><rvStructures xmlns="http://schemas.microsoft.com/office/spreadsheetml/2017/richdata" count="1">` +
          `<s t="_localImage"><k n="_rvRel:LocalImageIdentifier" t="i"/><k n="CalcOrigin" t="i"/></s></rvStructures>`,
      ),
    },
    {
      name: 'xl/richData/richValueRel.xml',
      data: enc.encode(
        `<?xml version="1.0"?><richValueRels xmlns="http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel" ` +
          `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><rel r:id="rId1"/></richValueRels>`,
      ),
    },
    {
      name: 'xl/richData/_rels/richValueRel.xml.rels',
      data: enc.encode(
        `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>`,
      ),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: enc.encode(
        `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
          `<sheetData>` +
          `<row r="1"><c r="A1" t="inlineStr"><is><t>组长</t></is></c><c r="B1" t="inlineStr"><is><t>凭证</t></is></c></row>` +
          `<row r="2"><c r="A2" t="inlineStr"><is><t>张三</t></is></c><c r="B2" vm="1" t="e"><v>#VALUE!</v></c></row>` +
          `</sheetData></worksheet>`,
      ),
    },
    { name: 'xl/media/image1.png', data: PNG_BYTES },
  ])
}

describe('xlsx 嵌入单元格图片（richData）提取', () => {
  it('单元格 vm 引用 → metadata → richData → media，坐标与字节正确', async () => {
    const doc = await parseSheet(makeRichValueXlsx(), '嵌入图片.xlsx')
    const table = doc.blocks.find((b) => b.type === 'table')
    expect(table).toBeDefined()
    expect(doc.images).toHaveLength(1)
    const img = doc.images![0]
    expect(img.sheet).toBe('明细列表')
    expect(img.row).toBe(1)
    expect(img.col).toBe(1)
    expect(img.name).toBe('image1.png')
    expect(img.bytes.length).toBe(PNG_BYTES.length)
  })
})
