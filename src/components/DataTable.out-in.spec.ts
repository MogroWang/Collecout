// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, Transition } from 'vue'
import CardGrid from './CardGrid.vue'
import DataTable from './DataTable.vue'

/**
 * 回归测试：库页表格/卡片视图切换。
 * <Transition mode="out-in"> 的子组件必须是单根节点。旧版 DataTable 的模板是
 * <table> + <Teleport> 两个根节点（fragment），Vue 只发出
 * "renders non-element root node" 警告，但切换后新视图不渲染、旧视图也回不去，
 * 整个视图切换永久卡死。DataTable 现已包上单根容器，此测试用真实组件
 * 在 Transition 中来回切换多次，守护该约束。
 */

/** Transition 的换装依赖 rAF 与 transitionend；happy-dom 下需要真实等待若干帧 */
async function settle(frames = 6) {
  for (let i = 0; i < frames; i++) {
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    await new Promise((r) => setTimeout(r, 16))
  }
  await nextTick()
}

describe('DataTable/CardGrid in <Transition mode="out-in">', () => {
  it('keeps swapping between table and cards repeatedly', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    const view = ref<'table' | 'cards'>('table')
    const app = createApp(
      defineComponent({
        setup() {
          const props = {
            fields: [],
            entries: [],
            selected: new Set<string>(),
            sort: null,
            multiSelect: false,
            imageUrls: {},
          }
          return () =>
            h(Transition, { name: 'fade', mode: 'out-in' }, () =>
              view.value === 'table'
                ? h(DataTable, { ...props, 'onUpdate:sort': () => {} })
                : h(CardGrid, props),
            )
        },
      }),
    )
    app.mount(host)

    const cycles: Array<['table' | 'cards', string]> = [
      ['cards', 'card-grid'],
      ['table', 'data-table-wrap'],
      ['cards', 'card-grid'],
      ['table', 'data-table-wrap'],
    ]
    for (const [next, marker] of cycles) {
      view.value = next
      await nextTick()
      await settle()
      // 若失败：说明 <Transition out-in> 的子组件又出现了多根节点，切换会整体卡死
      expect(host.querySelector(`.${marker}`)).not.toBeNull()
    }
    app.unmount()
  })
})
