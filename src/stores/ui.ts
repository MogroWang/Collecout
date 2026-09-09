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
  }),
  actions: {
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
