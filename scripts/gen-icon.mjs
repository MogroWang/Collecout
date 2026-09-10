/**
 * 应用图标生成管线（零依赖，纯 Node 内置 zlib）：
 *   1. 解析「Collecout graphic logo.svg」的路径（M/L/H/V/C/S/Z + 仿射矩阵），
 *      展平为多边形后用 nonzero 扫描线填充 + 4×4 超采样光栅化；
 *   2. 按平台规格输出：
 *      - src-tauri/icons：icon.ico（Windows，白底圆角）、icon.icns（macOS 传统规格，
 *        macOS 26+ 由系统自动遮罩适配）、Tauri/UWP 各尺寸 PNG；
 *      - android mipmap：legacy 启动器 + 自适应图标前景；
 *      - app-icon.png：1024 源图（存档）。
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOGO_SVG = process.env.LOGO_SVG ?? join(ROOT, '..', 'Collecout Design', 'Collecout graphic logo.svg')
const OUT = join(ROOT, 'src-tauri', 'icons')
const OUT_ANDROID = join(ROOT, 'android', 'app', 'src', 'main', 'res')

const GREEN = [71, 151, 79] // #479F4F
const WHITE = [255, 255, 255]
const CLR = [0, 0, 0]

// ---------- PNG 编码 ----------
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
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 1 // filter: sub（对大面积纯色压缩友好）
    const row = rgba.subarray(y * width * 4, (y + 1) * width * 4)
    for (let i = row.length - 1; i >= 4; i--) row[i] = (row[i] - row[i - 4]) & 0xff
    row.copy(raw, y * (width * 4 + 1) + 1)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

// ---------- SVG 解析（只支持 logo 用到的子集：g/matrix + path 的 M/L/H/V/C/S/Z） ----------
function mul(a, b) {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}

function apply(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

function parseTransform(s) {
  let m = [1, 0, 0, 1, 0, 0]
  const re = /(\w+)\s*\(([^)]*)\)/g
  let g
  while ((g = re.exec(s))) {
    const n = g[2].split(/[\s,]+/).map(Number)
    if (g[1] === 'matrix') m = mul(m, n)
    else if (g[1] === 'translate') m = mul(m, [1, 0, 0, 1, n[0], n[1] ?? 0])
    else if (g[1] === 'scale') m = mul(m, [n[0], 0, 0, n[1] ?? n[0], 0, 0])
    else throw new Error(`不支持的 transform: ${g[1]}`)
  }
  return m
}

/** 把 path 的 d 属性展平为折线（细分贝塞尔），返回点数组 */
function flattenPath(d, ctm, SUB = 24) {
  const tokens = d.match(/[a-zA-Z]|-?\.?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g) ?? []
  let i = 0
  let cx = 0
  let cy = 0
  let startX = 0
  let startY = 0
  let cmd = ''
  const polys = []
  let cur = []
  const next = () => Number(tokens[i++])
  const peek = () => /[a-zA-Z]/.test(tokens[i] ?? '')

  const emit = (x, y) => {
    const [px, py] = apply(ctm, x, y)
    cur.push([px, py])
  }

  while (i < tokens.length) {
    if (peek()) cmd = tokens[i++]
    const rel = cmd >= 'a' && cmd <= 'z'
    const c = cmd.toLowerCase()
    const dx = (v) => (rel ? cx + v : v)
    const dy = (v) => (rel ? cy + v : v)
    switch (c) {
      case 'm': {
        const x = dx(next())
        const y = dy(next())
        if (cur.length > 1) polys.push(cur)
        cur = []
        cx = startX = x
        cy = startY = y
        emit(cx, cy)
        cmd = rel ? 'l' : 'L'
        break
      }
      case 'l': {
        cx = dx(next())
        cy = dy(next())
        emit(cx, cy)
        break
      }
      case 'h': {
        cx = dx(next())
        emit(cx, cy)
        break
      }
      case 'v': {
        cy = dy(next())
        emit(cx, cy)
        break
      }
      case 'c': {
        const x1 = dx(next())
        const y1 = dy(next())
        const x2 = dx(next())
        const y2 = dy(next())
        const x = dx(next())
        const y = dy(next())
        for (let k = 1; k <= SUB; k++) {
          const tt = k / SUB
          const u = 1 - tt
          const bx = u * u * u * cx + 3 * u * u * tt * x1 + 3 * u * tt * tt * x2 + tt * tt * tt * x
          const by = u * u * u * cy + 3 * u * u * tt * y1 + 3 * u * tt * tt * y2 + tt * tt * tt * y
          emit(bx, by)
        }
        cx = x
        cy = y
        break
      }
      case 's': {
        // 反射控制点：上一段的 (x2,y2)（这里从简化，logo 未用到 S 的连续平滑精度差异）
        const x2 = dx(next())
        const y2 = dy(next())
        const x = dx(next())
        const y = dy(next())
        const x1 = cx
        const y1 = cy
        for (let k = 1; k <= SUB; k++) {
          const tt = k / SUB
          const u = 1 - tt
          const bx = u * u * u * cx + 3 * u * u * tt * x1 + 3 * u * tt * tt * x2 + tt * tt * tt * x
          const by = u * u * u * cy + 3 * u * u * tt * y1 + 3 * u * tt * tt * y2 + tt * tt * tt * y
          emit(bx, by)
        }
        cx = x
        cy = y
        break
      }
      case 'z': {
        if (cur.length > 0) {
          emit(startX, startY)
          polys.push(cur)
          cur = []
        }
        cx = startX
        cy = startY
        break
      }
      default:
        throw new Error(`不支持的路径命令: ${cmd}`)
    }
  }
  if (cur.length > 1) polys.push(cur)
  return polys
}

/** 解析 SVG 里所有 path（按文档顺序）。path 是叶子节点，不参与 transform 栈的进出 */
function parseSvgPaths(svg) {
  const polys = []
  const stack = [[1, 0, 0, 1, 0, 0]]
  const re = /<(\/?)g([^>]*)>|<(\/?)path([^>]*)>/g
  let m
  while ((m = re.exec(svg))) {
    const isPath = m[2] === undefined
    const attrs = (isPath ? m[4] : m[2]) ?? ''
    if (isPath) {
      let ctm = stack[stack.length - 1]
      const tm = /transform="([^"]*)"/.exec(attrs)
      if (tm) ctm = mul(ctm, parseTransform(tm[1]))
      const d = /d="([^"]*)"/.exec(attrs)
      if (d) polys.push(...flattenPath(d[1], ctm))
      continue
    }
    if (m[1] === '/') {
      stack.pop()
      continue
    }
    let ctm = stack[stack.length - 1]
    const tm = /transform="([^"]*)"/.exec(attrs)
    if (tm) ctm = mul(ctm, parseTransform(tm[1]))
    stack.push(ctm)
  }
  return polys
}

// ---------- 几何 ----------
function bboxOf(polys) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of polys) {
    for (const [x, y] of p) {
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 }
}

/** 把多边形平移缩放：viewBox 空间 → 目标空间 */
function fitTransform(polys, bb, size, contentRatio) {
  // contentRatio: 图形最长边相对画布的占比
  const scale = (size * contentRatio) / Math.max(bb.w, bb.h)
  const offX = (size - bb.w * scale) / 2 - bb.x0 * scale
  const offY = (size - bb.h * scale) / 2 - bb.y0 * scale
  return [scale, 0, 0, scale, offX, offY]
}

function xform(polys, m) {
  return polys.map((p) => p.map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]))
}

// ---------- nonzero 扫描线光栅化 ----------
/** 预处理：按 y 分桶的边表 */
function edgeTable(polys) {
  const edges = []
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i]
      const [x1, y1] = p[(i + 1) % p.length]
      if (y0 === y1) continue
      edges.push(y0 < y1 ? { yMin: y0, yMax: y1, xAt: x0, dx: (x1 - x0) / (y1 - y0), dir: 1 } : { yMin: y1, yMax: y0, xAt: x1, dx: (x1 - x0) / (y1 - y0), dir: -1 })
    }
  }
  const perRow = new Map()
  for (const e of edges) {
    const from = Math.floor(e.yMin)
    const to = Math.floor(e.yMax)
    for (let r = from; r <= to; r++) {
      if (!perRow.has(r)) perRow.set(r, [])
      perRow.get(r).push(e)
    }
  }
  return perRow
}

/** 一条扫描线 y 上的覆盖区间（nonzero） */
function spansAt(table, y) {
  const list = table.get(Math.floor(y))
  if (!list) return []
  const xs = []
  for (const e of list) {
    if (y < e.yMin || y >= e.yMax) continue
    xs.push([(e.xAt + (y - e.yMin) * e.dx), e.dir])
  }
  if (xs.length === 0) return []
  xs.sort((a, b) => a[0] - b[0])
  const spans = []
  let wind = 0
  let spanStart = 0
  for (const [x, dir] of xs) {
    if (wind === 0) spanStart = x
    wind += dir
    if (wind === 0 && x > spanStart) spans.push([spanStart, x])
  }
  return spans
}

function coverageAt(table, x, y) {
  let hit = 0
  for (const [sx0, sx1] of spansAt(table, y)) {
    if (x >= sx0 && x < sx1) {
      hit = 1
      break
    }
  }
  return hit
}

const SUBS = [
  [0.125, 0.125],
  [0.375, 0.125],
  [0.625, 0.125],
  [0.875, 0.125],
  [0.125, 0.375],
  [0.375, 0.375],
  [0.625, 0.375],
  [0.875, 0.375],
  [0.125, 0.625],
  [0.375, 0.625],
  [0.625, 0.625],
  [0.875, 0.625],
  [0.125, 0.875],
  [0.375, 0.875],
  [0.625, 0.875],
  [0.875, 0.875],
]

/** 合成渲染器：白底板（满幅或 80.5% macOS 规格）× logo 图形 */
function render(polys166, size, opts) {
  const { boardRatio = 1, boardRadius = 0.2, logoRatio = 0.66 } = opts
  const rgba = Buffer.alloc(size * size * 4)

  // logo 边表（按画布坐标）
  const bb = bboxOf(polys166)
  const fit = fitTransform(polys166, bb, size, logoRatio)
  const logoPolys = xform(polys166, fit)
  const logoTable = edgeTable(logoPolys)

  // 背景板：boardRatio × size 居中，圆角半径相对板边
  const board = size * boardRatio
  const r = board * boardRadius
  const off = (size - board) / 2
  const bgTest = (px, py) => {
    const x = px + 0.5 - off
    const y = py + 0.5 - off
    if (x < 0 || y < 0 || x > board || y > board) return false
    const qx = Math.max(r - x, x - (board - r))
    const qy = Math.max(r - y, y - (board - r))
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) <= r
  }

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let cr = 0
      let cg = 0
      let cb = 0
      let a = 0
      for (const [sx, sy] of SUBS) {
        const x = px + sx
        const y = py + sy
        let color = null
        if (bgTest(px, py)) color = WHITE
        if (coverageAt(logoTable, x, y)) color = GREEN
        if (color) {
          cr += color[0]
          cg += color[1]
          cb += color[2]
          a += 255
        }
      }
      const i = (py * size + px) * 4
      rgba[i] = Math.round(cr / SUBS.length)
      rgba[i + 1] = Math.round(cg / SUBS.length)
      rgba[i + 2] = Math.round(cb / SUBS.length)
      rgba[i + 3] = Math.round(a / SUBS.length)
    }
  }
  return rgba
}

// ---------- ICO / ICNS ----------
function encodeIco(images) {
  // images: [{ size, png }]
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = []
  let offset = 6 + images.length * 16
  for (const img of images) {
    const e = Buffer.alloc(16)
    e[0] = img.size >= 256 ? 0 : img.size
    e[1] = img.size >= 256 ? 0 : img.size
    e.writeUInt16LE(1, 4)
    e.writeUInt16LE(32, 6)
    e.writeUInt32LE(img.png.length, 8)
    e.writeUInt32LE(offset, 12)
    entries.push(e)
    offset += img.png.length
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)])
}

function encodeIcns(images) {
  // images: [{ type, png }]
  const bufs = images.map((img) => {
    const head = Buffer.alloc(8)
    head.write(img.type, 0, 'ascii')
    head.writeUInt32BE(img.png.length + 8, 4)
    return Buffer.concat([head, img.png])
  })
  const total = bufs.reduce((n, b) => n + b.length, 8)
  const head = Buffer.alloc(8)
  head.write('icns', 0, 'ascii')
  head.writeUInt32BE(total, 4)
  return Buffer.concat([head, ...bufs])
}

// ---------- 主流程 ----------
const svg = readFileSync(LOGO_SVG, 'utf8')
const polys166 = parseSvgPaths(svg)
const bb = bboxOf(polys166)
console.log(`logo 解析：${polys166.length} 条路径，bbox ${bb.w.toFixed(1)}×${bb.h.toFixed(1)}`)

const png = (rgba, s) => encodePng(rgba, s, s)

/** Windows / Linux 通用样式：满幅白底圆角 + 居中 logo */
const winStyle = (s, radius = 0.2, logoRatio = 0.64) => png(render(polys166, s, { boardRatio: 1, boardRadius: radius, logoRatio }), s)
/** macOS 传统规格：824/1024 白底圆角板 + logo，系统会为 macOS 26 自动遮罩适配 */
const macStyle = (s) => png(render(polys166, s, { boardRatio: 0.805, boardRadius: 0.225, logoRatio: 0.52 }), s)
/** Android 自适应前景：透明底，logo 落在中心 62% 安全区内 */
const androidFg = (s) => png(render(polys166, s, { boardRatio: 0, logoRatio: 0.62 }), s)

mkdirSync(OUT, { recursive: true })
const jobs = []
const emit = (file, buf) => {
  writeFileSync(join(OUT, file), buf)
  jobs.push(file)
}

// Tauri bundle.icon 引用的核心文件（白底圆角样式）
for (const [s, name] of [
  [32, '32x32.png'],
  [64, '64x64.png'],
  [128, '128x128.png'],
  [256, '128x128@2x.png'],
  [256, 'icon.png'],
]) emit(name, winStyle(s))

// UWP 磁贴
for (const [s, name] of [
  [44, 'Square44x44Logo.png'],
  [71, 'Square71x71Logo.png'],
  [89, 'Square89x89Logo.png'],
  [107, 'Square107x107Logo.png'],
  [142, 'Square142x142Logo.png'],
  [150, 'Square150x150Logo.png'],
  [284, 'Square284x284Logo.png'],
  [310, 'Square310x310Logo.png'],
  [30, 'Square30x30Logo.png'],
  [50, 'StoreLogo.png'],
]) emit(name, winStyle(s, 0.12))

// Windows ico（白底圆角）
emit(
  'icon.ico',
  encodeIco([16, 24, 32, 48, 64, 128, 256].map((s) => ({ size: s, png: winStyle(s) }))),
)

// macOS icns（传统规格，macOS 26+ 自动适配新样式）
emit(
  'icon.icns',
  encodeIcns([
    { type: 'icp4', png: macStyle(16) },
    { type: 'icp5', png: macStyle(32) },
    { type: 'ic11', png: macStyle(32) },
    { type: 'ic12', png: macStyle(64) },
    { type: 'ic07', png: macStyle(128) },
    { type: 'ic13', png: macStyle(256) },
    { type: 'ic08', png: macStyle(256) },
    { type: 'ic14', png: macStyle(512) },
    { type: 'ic09', png: macStyle(512) },
    { type: 'ic10', png: macStyle(1024) },
  ]),
)

// 1024 源图存档
emit('app-icon.png', winStyle(1024))

// Android：legacy 启动器（方 / 圆）+ 自适应前景
const dpi = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 }
for (const [d, k] of Object.entries(dpi)) {
  const dir = join(OUT_ANDROID, `mipmap-${d}`)
  mkdirSync(dir, { recursive: true })
  const legacy = Math.round(48 * k)
  const fg = Math.round(108 * k)
  writeFileSync(join(dir, 'ic_launcher.png'), winStyle(legacy, 0.2))
  writeFileSync(join(dir, 'ic_launcher_round.png'), winStyle(legacy, 0.5))
  writeFileSync(join(dir, 'ic_launcher_foreground.png'), androidFg(fg))
  jobs.push(`android/mipmap-${d}/*`)
}

console.log(`已生成 ${jobs.length} 项图标资产`)
