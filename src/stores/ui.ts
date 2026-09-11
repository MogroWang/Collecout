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
  }),
  actions: {
    setPageTitle(title: string) {
      this.pageTitle = title
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
