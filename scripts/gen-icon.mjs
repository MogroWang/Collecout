/**
 * 生成 1024×1024 应用图标源图（app-icon.png）。
 * 仅用 Node 内置 zlib，无第三方依赖：几何光栅化 + PNG 编码。
 * 之后由 `tauri icon` 生成全套尺寸。
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SIZE = 1024
const TEAL = [14, 111, 99] // #0E6F63 墨青
const WHITE = [255, 255, 255]

const crcTable = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(rgba, width, height) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // 位深
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// ---------- 几何 SDF（坐标均为 0..1 归一化） ----------
function roundedRectSDF(x, y, cx, cy, halfW, halfH, r) {
  const qx = Math.abs(x - cx) - (halfW - r)
  const qy = Math.abs(y - cy) - (halfH - r)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r
}

function segSDF(x, y, ax, ay, bx, by) {
  const abx = bx - ax
  const aby = by - ay
  const apx = x - ax
  const apy = y - ay
  const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / (abx * abx + aby * aby)))
  return Math.hypot(apx - abx * t, apy - aby * t)
}

function circleSDF(x, y, cx, cy, r) {
  return Math.hypot(x - cx, y - cy) - r
}

function triInside(x, y, ax, ay, bx, by, cx, cy) {
  const d1 = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
  const d2 = (cx - bx) * (y - by) - (cy - by) * (x - bx)
  const d3 = (ax - cx) * (y - cy) - (ay - cy) * (x - cx)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

// 图标语言：漏斗 + 液滴——「萃取、归整」的直白几何表达
const FUNNEL = [
  [0.3, 0.27, 0.7, 0.27],
  [0.3, 0.27, 0.44, 0.455],
  [0.7, 0.27, 0.56, 0.455],
  [0.5, 0.455, 0.5, 0.56],
]
const STROKE = 0.052
const DROP_APEX = [0.5, 0.585]
const DROP_BULB = [0.5, 0.752]
const DROP_R = 0.082
const DROP_EDGE = 0.058 // 液滴三角形底边半宽（落在 bulb 圆内，衔接处平滑）

function motifInside(x, y) {
  const strokes = FUNNEL.map(([ax, ay, bx, by]) => segSDF(x, y, ax, ay, bx, by))
  if (Math.min(...strokes) <= STROKE / 2) return true
  const drop =
    circleSDF(x, y, DROP_BULB[0], DROP_BULB[1], DROP_R) <= 0 ||
    triInside(x, y, DROP_APEX[0], DROP_APEX[1], DROP_BULB[0] - DROP_EDGE, DROP_BULB[1], DROP_BULB[0] + DROP_EDGE, DROP_BULB[1])
  return drop
}

function inside(x, y) {
  const bg = roundedRectSDF(x, y, 0.5, 0.5, 0.5, 0.5, 0.22)
  if (bg > 0) return null
  return motifInside(x, y) ? WHITE : TEAL
}

// ---------- 光栅化（2×2 超采样） ----------
const rgba = Buffer.alloc(SIZE * SIZE * 4)
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    let r = 0
    let g = 0
    let b = 0
    let a = 0
    for (const [sx, sy] of [
      [0.25, 0.25],
      [0.75, 0.25],
      [0.25, 0.75],
      [0.75, 0.75],
    ]) {
      const x = (px + sx) / SIZE
      const y = (py + sy) / SIZE
      const c = inside(x, y)
      if (c) {
        r += c[0]
        g += c[1]
        b += c[2]
        a += 255
      }
    }
    const i = (py * SIZE + px) * 4
    rgba[i] = Math.round(r / 4)
    rgba[i + 1] = Math.round(g / 4)
    rgba[i + 2] = Math.round(b / 4)
    rgba[i + 3] = Math.round(a / 4)
  }
}

const out = fileURLToPath(new URL('..', import.meta.url))
mkdirSync(out, { recursive: true })
const file = join(out, 'app-icon.png')
writeFileSync(file, encodePng(rgba, SIZE, SIZE))
console.log(`已生成 ${file}`)
