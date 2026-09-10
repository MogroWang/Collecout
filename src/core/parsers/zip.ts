/**
 * 最小 ZIP 读取器（只读）：用于解开 xlsx/docx 等 OOXML 包，提取内嵌媒体。
 * 仅支持 stored 与 deflate 两种压缩方式；deflate 用运行时原生的
 * DecompressionStream('deflate-raw')，不支持的环境由调用方降级。
 */

export interface ZipEntry {
  name: string
  data: Uint8Array
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前运行环境不支持解压缩')
  }
  const ds = new DecompressionStream('deflate-raw')
  const stream = new Blob([data.slice().buffer as ArrayBuffer]).stream().pipeThrough(ds)
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

/** 列出并解出包内全部条目（顺序与 central directory 一致） */
export async function readZip(bytes: Uint8Array): Promise<ZipEntry[]> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // 从尾部向前找 End of Central Directory（0x06054b50），允许存在注释
  let eocd = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65536); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 zip 包')

  const entryCount = dv.getUint16(eocd + 10, true)
  let ptr = dv.getUint32(eocd + 16, true)
  const dec = new TextDecoder()
  const entries: ZipEntry[] = []

  for (let n = 0; n < entryCount; n++) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break
    const method = dv.getUint16(ptr + 10, true)
    const compSize = dv.getUint32(ptr + 20, true)
    const nameLen = dv.getUint16(ptr + 28, true)
    const extraLen = dv.getUint16(ptr + 30, true)
    const commentLen = dv.getUint16(ptr + 32, true)
    const localOffset = dv.getUint32(ptr + 42, true)
    const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen))
    ptr += 46 + nameLen + extraLen + commentLen

    // local file header 里的 name/extra 长度可能与 central 不一致，重新读一次
    const lNameLen = dv.getUint16(localOffset + 26, true)
    const lExtraLen = dv.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const raw = bytes.subarray(dataStart, dataStart + compSize)
    const data = method === 0 ? raw.slice() : method === 8 ? await inflateRaw(raw) : raw
    entries.push({ name, data })
  }
  return entries
}
