// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'vue/compiler-sfc'

/**
 * 静态守护：<Transition mode="out-in">（页面切换、视图切换）要求子组件单根。
 * 根级 HTML 注释在 dev 下会保留为注释节点、根级 v-if 的空分支渲染为注释节点，
 * 两者都会让组件根变成 fragment/注释 → 切换永久卡死成空白页。
 * 该问题在生产构建剥离注释后会"消失"，只在 dev 预览暴露，极易复发（已连踩两次），
 * 因此在编译 AST 层面拦截：
 *  - 全部 .vue：模板根级不得出现注释节点；
 *  - views/（全部经由页面切换 Transition）：根级只能是单个元素，或一对 v-if / v-else 分支。
 */

const ROOT = join(__dirname, '..')

function collectVueFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue
      out.push(...collectVueFiles(p))
    } else if (name.endsWith('.vue')) {
      out.push(p)
    }
  }
  return out
}

interface TopNode {
  type: number
  tag?: string
  props: { name: string }[]
}

describe('template roots are Transition-safe', () => {
  const files = collectVueFiles(ROOT)

  it('scanned some files (sanity)', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  it('no root-level comments in any template', () => {
    const offenders: string[] = []
    for (const f of files) {
      const { descriptor } = parse(readFileSync(f, 'utf8'), { filename: f })
      const ast = descriptor.template?.ast
      const comments = (ast?.children ?? []).filter((n) => n.type === 3)
      if (comments.length > 0) offenders.push(f)
    }
    expect(offenders, '根级注释节点（移入根元素内部）').toEqual([])
  })

  it('views render a single root element (v-if/v-else pair allowed)', () => {
    const offenders: string[] = []
    for (const f of files.filter((x) => x.includes(`${join('src', 'views')}`))) {
      const { descriptor } = parse(readFileSync(f, 'utf8'), { filename: f })
      const ast = descriptor.template?.ast
      const tops: TopNode[] = (ast?.children ?? []).filter(
        (n) => n.type !== 2 || n.content.trim() !== '',
      ) as unknown as TopNode[]
      const elements = tops.filter((n) => n.type === 1)
      const okSingle = elements.length === 1
      const okIfElse =
        elements.length === 2 &&
        elements.every((el) => el.props.some((p) => p.name === 'if' || p.name === 'else' || p.name === 'else-if'))
      if (!okSingle && !okIfElse) offenders.push(`${f}（顶层元素 ${elements.length} 个）`)
    }
    expect(offenders, 'views 根级必须是单元素或 v-if/v-else 对').toEqual([])
  })
})
