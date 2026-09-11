import { defineStore } from 'pinia'

export interface Toast {
  id: number
  kind: 'info' | 'warn' | 'danger'
  text: string
}

let seq = 0

export const useUiStore = defineStore('ui', {
  state: () => ({
    toasts: [] as Toast[],
    /** 标题栏当前显示的页面标题；空串时显示应用名 */
    pageTitle: '',
    /** 鼠标悬停在某控件上时的用途说明；空串时标题栏中间回落显示页面标题 */
    hoverHint: '',
    /** 桌面侧边栏是否收起（点右下角按钮折叠，标题栏按钮展开） */
    sidebarCollapsed: false,
  }),
  actions: {
    setPageTitle(title: string) {
      this.pageTitle = title
    },
    setHoverHint(hint: string | null) {
      this.hoverHint = hint ?? ''
    },
    toast(text: string, kind: Toast['kind'] = 'info', duration = 3200) {
      const id = ++seq
      this.toasts.push({ id, kind, text })
      setTimeout(() => this.dismiss(id), duration)
    },
    dismiss(id: number) {
      this.toasts = this.toasts.filter((x) => x.id !== id)
    },
  },
})
