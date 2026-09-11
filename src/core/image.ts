/**
 * 图片字节的通用工具：类型判断与像素尺寸读取。
 * 导出（docx / xlsx / PDF）与导入预览共用；零依赖，直接解析二进制头。
 */

/** 按扩展名判断 MIME；不支持的类型返回 null */
export function imageMimeOf(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'bmp':
      return 'image/bmp'
    case 'webp':
      return 'image/webp'
    default:
      return null
  }
}

export function imageExtOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? 'png'
}

/** 把图片字节包成 Blob（未知扩展名按 png 处理；解析不出类型时返回 null） */
export function imageBlobOf(name: string, bytes: Uint8Array): Blob | null {
  const mime = imageMimeOf(name) ?? (name.includes('.') ? null : 'image/png')
  if (!mime) return null
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime })
}

/** 读取 PNG / JPEG 的像素尺寸；解析失败返回 null（调用方自行给默认值） */
export function readImageSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return { w: view.getUint32(16), h: view.getUint32(20) }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes)
  return null
}

/** JPEG：扫描 SOFn 标记段取宽高 */
function jpegSize(bytes: Uint8Array): { w: number; h: number } | null {
  let i = 2
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++
      continue
    }
    const marker = bytes[i + 1]
    // SOF0-SOF15，去掉 DHT(4)/JPG(8)/DAC(C) 等非帧标记
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      return { h: view.getUint16(i + 5), w: view.getUint16(i + 7) }
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    i += 2 + len
  }
  return null
}
