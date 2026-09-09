import { describe, expect, it } from 'vitest'
import { findDates, normalizeDateValue, normalizeNumberValue, parseDateSmart } from './datetime'

describe('parseDateSmart', () => {
  it('解析中文完整日期', () => {
    expect(parseDateSmart('2026年9月3日')?.iso).toBe('2026-09-03')
    expect(parseDateSmart('2026年9月3日')?.confidence).toBe(0.9)
  })
  it('解析横杠 / 斜杠 / 点分隔', () => {
    expect(parseDateSmart('2026-09-03')?.iso).toBe('2026-09-03')
    expect(parseDateSmart('2026/9/3')?.iso).toBe('2026-09-03')
    expect(parseDateSmart('2026.9.3')?.iso).toBe('2026-09-03')
  })
  it('解析到月并补 1 日', () => {
    expect(parseDateSmart('2026年9月')?.iso).toBe('2026-09-01')
  })
  it('无年份时补当前年且置信度低', () => {
    const hit = parseDateSmart('发布于 9月9日')
    expect(hit?.iso).toBe(`${new Date().getFullYear()}-09-09`)
    expect(hit?.confidence).toBeLessThan(0.6)
  })
  it('解析英文日期', () => {
    expect(parseDateSmart('Sep 3, 2026')?.iso).toBe('2026-09-03')
    expect(parseDateSmart('3 September 2026')?.iso).toBe('2026-09-03')
  })
  it('忽略时间部分', () => {
    expect(parseDateSmart('2026-08-28 14:00')?.iso).toBe('2026-08-28')
  })
  it('不把普通数字当日期', () => {
    expect(parseDateSmart('电话 13800000000')).toBeNull()
    expect(parseDateSmart('数量 32')).toBeNull()
  })
  it('拒绝不存在的日期', () => {
    expect(parseDateSmart('2026年13月40日')).toBeNull()
  })
})

describe('findDates', () => {
  it('按出现顺序返回多个日期且去重', () => {
    const hits = findDates('2026年8月28日 开工，2026-09-09 发布')
    expect(hits).toHaveLength(2)
    expect(hits[0].iso).toBe('2026-08-28')
    expect(hits[1].iso).toBe('2026-09-09')
    expect(hits[0].index).toBeLessThan(hits[1].index)
  })
})

describe('normalize 工具', () => {
  it('normalizeDateValue 返回 ISO', () => {
    expect(normalizeDateValue('2026年9月3日')).toBe('2026-09-03')
    expect(normalizeDateValue('没有日期')).toBeNull()
  })
  it('normalizeNumberValue 处理货币与千分位', () => {
    expect(normalizeNumberValue('￥1,234.50')).toBe(1234.5)
    expect(normalizeNumberValue('32.5')).toBe(32.5)
    expect(normalizeNumberValue('-8元')).toBe(-8)
    expect(normalizeNumberValue('没有数字')).toBeNull()
  })
})
